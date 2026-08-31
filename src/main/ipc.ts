import { BrowserWindow, dialog, ipcMain } from 'electron'
// Inlined at build time. app.getVersion() reports Electron's own version
// whenever the app is started without its package.json beside it, which is
// exactly the case when the app is driven by a script.
import { version } from '../../package.json'
import type {
  AppInfo,
  AnonResult,
  BurnInFinding,
  CaseSummary,
  IngestResult,
  PreviewFrame,
  Progress,
  ReformatPlan,
  ReformatRequestMessage,
  StackSelection,
  VolumeInfo
} from '@shared/types'
import { anonymiseStacks, summariseWarnings } from './anon'
import { scanForBurnIn } from './burnInScan'
import { RadiopaediaClient, type CaseDraft } from './api/client'
import type { OAuthConfig } from './api/oauth'
import { loadConfig, saveConfig } from './api/store'
import { uploadStack } from './api/upload'
import { ingest } from './ingest'
import { MAX_PREVIEW_EDGE, MAX_VIEWER_EDGE, clearPreviewHeaders, readPreviewFrame } from './preview'
import { session } from './session'
import { closeVolume, commitReformat, openVolume, planCount, previewReformat } from './volume'
import { planStudies, type StudyDraftInput } from './uploadPlan'

let client: RadiopaediaClient | null = null

function broadcast(progress: Progress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('progress', progress)
  }
}

async function requireClient(): Promise<RadiopaediaClient> {
  client ??= await RadiopaediaClient.fromStoredConfig()
  if (!client) throw new Error('Radiopaedia application credentials are not configured yet')
  return client
}

export interface UploadRequest {
  /**
   * An existing draft to add to. When set the case is not created and the
   * draft below is not read: the case already has its title, its age and its
   * system, and the API has no way to change them.
   */
  caseId?: string | null
  caseDraft: CaseDraft
  /** One entry per DICOM study; each becomes a study on the Radiopaedia case. */
  studies: StudyDraftInput[]
}

/** Platform names as people say them, rather than as Node reports them. */
const OS_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function registerIpc(): void {
  ipcMain.handle('app:info', (): AppInfo => ({
    version,
    os: `${OS_NAMES[process.platform] ?? process.platform} ${process.getSystemVersion()}`,
    arch: process.arch,
    electron: process.versions.electron
  }))

  ipcMain.handle('source:pick', async (_e, kind: 'folder' | 'zip') => {
    const result = await dialog.showOpenDialog({
      title: kind === 'folder' ? 'Choose a DICOM folder' : 'Choose a DICOM zip',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
      filters: kind === 'zip' ? [{ name: 'Zip archive', extensions: ['zip'] }] : undefined
    })
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle('ingest:run', async (_e, paths: string[]): Promise<IngestResult> => {
    await session.reset()
    clearPreviewHeaders()
    const result = await ingest(paths, broadcast)
    session.ingest = result
    return result
  })

  ipcMain.handle('ingest:reset', async () => session.reset())

  ipcMain.handle('selection:set', (_e, selection: StackSelection[]) => {
    session.applySelection(selection)
  })

  // Reformatting. The volume itself never leaves the main process; the renderer
  // asks for frames of it exactly as it asks for frames of a file.
  ipcMain.handle('volume:open', async (_e, stackId: string): Promise<VolumeInfo> => openVolume(stackId))
  ipcMain.handle('volume:frame', (_e, request: ReformatRequestMessage, maxEdge: number): PreviewFrame =>
    previewReformat(request, Math.min(maxEdge, MAX_VIEWER_EDGE))
  )
  ipcMain.handle('volume:count', (_e, plan: ReformatPlan): number => planCount(plan))
  ipcMain.handle('volume:commit', async (_e, plan: ReformatPlan) => commitReformat(plan))
  ipcMain.handle('volume:close', () => closeVolume())

  // Runs on the selection as it stands — trim, masks and crop included — so an
  // area already blanked, or about to be cut off, is not reported back as
  // something to deal with.
  ipcMain.handle('burnIn:scan', async (): Promise<BurnInFinding[]> => scanForBurnIn(session.selectedStacks()))

  // Preview pixels for the renderer. Only paths belonging to the current ingest
  // are served, so the renderer cannot read arbitrary files through this bridge.
  ipcMain.handle('preview:frame', async (_e, filePath: string, frame: number, maxEdge?: number) => {
    const known = new Set(
      (session.ingest?.studies ?? []).flatMap((study) =>
        study.series.flatMap((series) => series.stacks.flatMap((stack) => stack.slices.map((s) => s.path)))
      )
    )
    if (!known.has(filePath)) throw new Error('Refusing to read a file outside the current import')
    // The viewer asks for more pixels than a card; anything larger is refused.
    const edge = Math.min(Math.max(maxEdge ?? MAX_PREVIEW_EDGE, 32), MAX_VIEWER_EDGE)
    return readPreviewFrame(filePath, frame, edge)
  })

  ipcMain.handle('anon:run', async (): Promise<AnonResult & { summary: ReturnType<typeof summariseWarnings> }> => {
    const stacks = session.selectedStacks()
    if (stacks.length === 0) throw new Error('No stacks selected')
    const result = await anonymiseStacks(stacks, await session.workDir(), broadcast)
    session.anon = result
    return { ...result, summary: summariseWarnings(result.warnings) }
  })

  ipcMain.handle('auth:configure', async (_e, config: OAuthConfig) => {
    const stored = await loadConfig()
    await saveConfig({ ...stored, oauth: config })
    client = await RadiopaediaClient.fromStoredConfig()
  })

  ipcMain.handle('auth:status', async () => {
    const stored = await loadConfig()
    client ??= await RadiopaediaClient.fromStoredConfig()
    return {
      configured: Boolean(stored.oauth?.clientId),
      authenticated: client?.isAuthenticated ?? false,
      redirectUri: stored.oauth?.redirectUri ?? null,
      scope: stored.oauth?.scope ?? null,
      usesOutOfBandFlow: client?.usesOutOfBandFlow ?? true,
      clientId: stored.oauth?.clientId ?? null
    }
  })

  ipcMain.handle('auth:beginSignIn', async () => {
    const c = await requireClient()
    return c.beginSignIn()
  })

  ipcMain.handle('auth:completeSignIn', async (_e, code: string) => {
    const c = await requireClient()
    await c.completeSignIn(code)
    return c.currentUser()
  })

  ipcMain.handle('auth:signOut', async () => {
    const c = await requireClient()
    await c.signOut()
  })

  ipcMain.handle('api:currentUser', async () => (await requireClient()).currentUser())

  // The drafts this account can still add images to. There is no filter in the
  // API, so the whole listing comes down and the drafts are picked out here.
  ipcMain.handle('api:draftCases', async (): Promise<CaseSummary[]> => (await requireClient()).draftCases())

  ipcMain.handle('upload:run', async (_e, request: UploadRequest) => {
    const c = await requireClient()
    const anon = session.anon
    if (!anon) throw new Error('Anonymise the selected series before uploading')

    const planned = planStudies(session.ingest?.studies ?? [], request.studies)
    if (planned.length === 0) throw new Error('No studies to upload')

    const stacks = session.selectedStacks()
    // A multiframe instance yields one anonymised file per frame, so the match
    // back to a slice is on the file *and* the frame, never the path alone.
    const key = (sourcePath: string, frame: number): string => `${sourcePath}#${frame}`
    const bySource = new Map(anon.files.map((f) => [key(f.sourcePath, f.frame), f]))

    // Adding to a draft creates no case, so the quota does not apply — and it
    // is exactly what a full quota leaves you able to do.
    let caseId = request.caseId ?? null

    if (caseId === null) {
      // Re-check the quota against the server. The renderer's copy can be stale —
      // the user may have created drafts elsewhere since this session started —
      // and a rejected case would otherwise surface as an opaque API error.
      const { quota } = await c.currentUser()
      if (quota?.allowedDraftCases !== null && quota !== null && quota.draftCaseCount >= quota.allowedDraftCases) {
        throw new Error(
          `Draft quota full: ${quota.draftCaseCount} of ${quota.allowedDraftCases} used. ` +
            'Publish or delete a draft case on Radiopaedia first. ' +
            'You can raise your quota at https://radiopaedia.org/supporters'
        )
      }
      caseId = await c.createCase(request.caseDraft)
    } else {
      // The case may have been published, sent for review or deleted since the
      // list was fetched, and only a draft takes new images. Checked here
      // because this is the last moment before anything is sent.
      const still = (await c.draftCases()).some((existing) => existing.id === caseId)
      if (!still) {
        throw new Error(
          'That case is no longer a draft on Radiopaedia, so it cannot take new images. ' +
            'It may have been published, sent for review, or deleted since the list was read.'
        )
      }
    }

    // Studies are created oldest first so the case timeline reads in order.
    let seriesDone = 0
    const seriesTotal = planned.reduce((n, p) => n + p.stackIds.length, 0)

    for (const plan of planned) {
      const studyId = await c.createStudy(caseId, {
        modality: plan.modality,
        findings: plan.findings,
        position: plan.position,
        caption: plan.caption
      })

      for (const stackId of plan.stackIds) {
        const stack = stacks.find((s) => s.id === stackId)
        if (!stack) continue

        const files = stack.slices
          .map((slice) => bySource.get(key(slice.path, slice.frame)))
          .filter((f): f is NonNullable<typeof f> => f !== undefined)
        if (files.length === 0) continue

        seriesDone++
        await uploadStack(c, caseId, studyId, files, (p) =>
          broadcast({ ...p, detail: `${stack.label} — series ${seriesDone}/${seriesTotal}` })
        )
      }
    }

    // mark_upload_finished is deliberately not called: an unmarked case stays a
    // draft, which is what adding images to it later needs, and marking one may
    // do more than unlock editing — see docs/internals/upload.md.
    return { caseId, url: `https://radiopaedia.org/cases/${caseId}` }
  })
}
