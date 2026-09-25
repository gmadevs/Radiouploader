import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
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
  UpdateStatus,
  VolumeInfo
} from '@shared/types'
import { anonymiseStacks, summariseWarnings } from './anon'
import { ffmpegVersion } from './codecs/video'
import { scanForBurnIn } from './burnInScan'
import { RadiopaediaClient } from './api/client'
import type { OAuthConfig } from './api/oauth'
import { loadConfig, updateConfig } from './api/store'
import { ingest } from './ingest'
import { MAX_PREVIEW_EDGE, MAX_VIEWER_EDGE, clearPreviewHeaders, readPreviewFrame } from './preview'
import { session } from './session'
import { checkForUpdate, setUpdateChecks, skipVersion } from './update'
import { closeVolume, commitReformat, openVolume, planCount, previewReformat } from './volume'
import { clearInterruptedUpload } from './interruptedUpload'
import { interruptedForSelection, uploadCase, type UploadRequest } from './uploadCase'

let client: RadiopaediaClient | null = null

function broadcast(progress: Progress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('progress', progress)
  }
}

async function requireClient(): Promise<RadiopaediaClient> {
  client ??= await RadiopaediaClient.fromStoredConfig()
  if (!client) throw new Error('Radiopaedia application credentials are not configured')
  return client
}

/** Platform names as people say them, rather than as Node reports them. */
const OS_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function registerIpc(): void {
  ipcMain.handle('app:info', async (): Promise<AppInfo> => ({
    version,
    os: `${OS_NAMES[process.platform] ?? process.platform} ${process.getSystemVersion()}`,
    arch: process.arch,
    electron: process.versions.electron,
    videoDecoder: await ffmpegVersion()
  }))

  // Version, and what it would take to move off it. Nothing is downloaded and
  // nothing is installed — see src/main/update.ts for why not.
  ipcMain.handle('update:check', async (): Promise<UpdateStatus> => checkForUpdate(version))
  ipcMain.handle('update:skip', async (_e, skipped: string) => skipVersion(skipped))
  ipcMain.handle('update:enable', async (_e, enabled: boolean) => setUpdateChecks(enabled))

  // The upgrade command, onto the clipboard. navigator.clipboard is not
  // available to a page loaded from file://, and this is the whole of what the
  // renderer would want it for.
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))

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
    await updateConfig((stored) => ({ ...stored, oauth: config }))
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

  ipcMain.handle('upload:run', async (_e, request: UploadRequest) => uploadCase(await requireClient(), request, broadcast))

  // An upload that stopped and that the current selection would carry on, so the
  // case step can say so and select its draft; and the way to start afresh.
  ipcMain.handle('upload:interrupted', async () => interruptedForSelection())
  ipcMain.handle('upload:discardInterrupted', async () => clearInterruptedUpload())
}
