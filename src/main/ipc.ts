import fs from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AnonResult, IngestResult, Progress } from '@shared/types'
import { anonymiseStacks, summariseWarnings } from './anon'
import { RadiopaediaClient, type CaseDraft, type StudyDraft } from './api/client'
import type { OAuthConfig } from './api/oauth'
import { loadConfig, saveConfig } from './api/store'
import { uploadStack } from './api/upload'
import { ingest } from './ingest'
import { session } from './session'

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
  studyDraft: StudyDraft
  /** Stack ids in upload order; each becomes one series on the case. */
  stackIds: string[]
}

export function registerIpc(): void {
  ipcMain.handle('source:pick', async (_e, kind: 'folder' | 'zip') => {
    const result = await dialog.showOpenDialog({
      title: kind === 'folder' ? 'Choose a DICOM folder' : 'Choose a DICOM zip',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
      filters: kind === 'zip' ? [{ name: 'Zip archive', extensions: ['zip'] }] : undefined
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('ingest:run', async (_e, sourcePath: string, kind: 'folder' | 'zip'): Promise<IngestResult> => {
    await session.reset()
    const result = await ingest(sourcePath, kind, broadcast)
    session.ingest = result
    return result
  })

  ipcMain.handle('ingest:reset', async () => session.reset())

  ipcMain.handle('selection:set', (_e, stackIds: string[]) => {
    session.applySelection(stackIds)
  })

  // Preview data for the renderer. Only paths belonging to the current ingest
  // are served, so the renderer cannot read arbitrary files through this bridge.
  ipcMain.handle('preview:read', async (_e, filePath: string): Promise<ArrayBuffer> => {
    const known = new Set(
      (session.ingest?.studies ?? []).flatMap((study) =>
        study.series.flatMap((series) => series.stacks.flatMap((stack) => stack.slices.map((s) => s.path)))
      )
    )
    if (!known.has(filePath)) throw new Error('Refusing to read a file outside the current import')
    const buf = await fs.readFile(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
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
      clientId: stored.oauth?.clientId ?? null
    }
  })

  ipcMain.handle('auth:signIn', async () => {
    const c = await requireClient()
    await c.signIn()
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

    const stacks = session.selectedStacks()
    const ordered = request.stackIds
      .map((id) => stacks.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
    if (ordered.length === 0) throw new Error('No stacks to upload')

    // Anonymised outputs are named "<stackIndex>-<sliceIndex>.dcm", which is how
    // each file is matched back to the stack it came from.
    const bySource = new Map(anon.files.map((f) => [f.sourcePath, f]))

    const caseId = await c.createCase(request.caseDraft)
    const studyId = await c.createStudy(caseId, request.studyDraft)

    let uploaded = 0
    for (const stack of ordered) {
      const files = stack.slices
        .map((slice) => bySource.get(slice.path))
        .filter((f): f is NonNullable<typeof f> => f !== undefined)
      if (files.length === 0) continue

      await uploadStack(c, caseId, studyId, files, (p) =>
        broadcast({ ...p, detail: `${stack.label} (${++uploaded}/${ordered.length})` })
      )
    }

    await c.markUploadFinished(caseId)
    return { caseId, url: `https://radiopaedia.org/cases/${caseId}` }
  })
}
