import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AnonResult, IngestResult, Progress } from '@shared/types'
import { anonymiseStacks, summariseWarnings } from './anon'
import { RadiopaediaClient, type CaseDraft } from './api/client'
import type { OAuthConfig } from './api/oauth'
import { loadConfig, saveConfig } from './api/store'
import { uploadStack } from './api/upload'
import { ingest } from './ingest'
import { clearPreviewHeaders, readPreviewFrame } from './preview'
import { session } from './session'
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
  caseDraft: CaseDraft
  /** One entry per DICOM study; each becomes a study on the Radiopaedia case. */
  studies: StudyDraftInput[]
}

export function registerIpc(): void {
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

  ipcMain.handle('selection:set', (_e, selection: { id: string; trimStart: number; trimEnd: number }[]) => {
    session.applySelection(selection)
  })

  // Preview pixels for the renderer. Only paths belonging to the current ingest
  // are served, so the renderer cannot read arbitrary files through this bridge.
  ipcMain.handle('preview:frame', async (_e, filePath: string, frame: number) => {
    const known = new Set(
      (session.ingest?.studies ?? []).flatMap((study) =>
        study.series.flatMap((series) => series.stacks.flatMap((stack) => stack.slices.map((s) => s.path)))
      )
    )
    if (!known.has(filePath)) throw new Error('Refusing to read a file outside the current import')
    return readPreviewFrame(filePath, frame)
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

  ipcMain.handle('upload:run', async (_e, request: UploadRequest) => {
    const c = await requireClient()
    const anon = session.anon
    if (!anon) throw new Error('Anonymise the selected series before uploading')

    const planned = planStudies(session.ingest?.studies ?? [], request.studies)
    if (planned.length === 0) throw new Error('No studies to upload')

    const stacks = session.selectedStacks()
    const bySource = new Map(anon.files.map((f) => [f.sourcePath, f]))

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

    const caseId = await c.createCase(request.caseDraft)

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

        // Frames of a multiframe file share one path and one uploaded file;
        // Radiopaedia expands the frames on its side.
        const seen = new Set<string>()
        const files = stack.slices
          .filter((slice) => !seen.has(slice.path) && seen.add(slice.path) !== undefined)
          .map((slice) => bySource.get(slice.path))
          .filter((f): f is NonNullable<typeof f> => f !== undefined)
        if (files.length === 0) continue

        seriesDone++
        await uploadStack(c, caseId, studyId, files, (p) =>
          broadcast({ ...p, detail: `${stack.label} — series ${seriesDone}/${seriesTotal}` })
        )
      }
    }

    await c.markUploadFinished(caseId)
    return { caseId, url: `https://radiopaedia.org/cases/${caseId}` }
  })
}
