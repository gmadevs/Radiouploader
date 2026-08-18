import { contextBridge, ipcRenderer } from 'electron'
import type { AnonResult, IngestResult, Progress } from '@shared/types'

/** The only surface the renderer has onto the filesystem and the network. */
const api = {
  pickSource: (kind: 'folder' | 'zip'): Promise<string | null> => ipcRenderer.invoke('source:pick', kind),
  ingest: (sourcePath: string, kind: 'folder' | 'zip'): Promise<IngestResult> =>
    ipcRenderer.invoke('ingest:run', sourcePath, kind),
  resetIngest: (): Promise<void> => ipcRenderer.invoke('ingest:reset'),
  setSelection: (stackIds: string[]): Promise<void> => ipcRenderer.invoke('selection:set', stackIds),
  readPreview: (filePath: string): Promise<ArrayBuffer> => ipcRenderer.invoke('preview:read', filePath),
  anonymise: (): Promise<AnonResult & { summary: { tag: string; text: string; level: number; count: number }[] }> =>
    ipcRenderer.invoke('anon:run'),

  configureAuth: (config: { clientId: string; clientSecret?: string; redirectUri: string }): Promise<void> =>
    ipcRenderer.invoke('auth:configure', config),
  authStatus: (): Promise<{
    configured: boolean
    authenticated: boolean
    redirectUri: string | null
    clientId: string | null
  }> => ipcRenderer.invoke('auth:status'),
  signIn: (): Promise<{ username: string | null; quota: { draftCaseCount: number; allowedDraftCases: number } | null }> =>
    ipcRenderer.invoke('auth:signIn'),
  signOut: (): Promise<void> => ipcRenderer.invoke('auth:signOut'),
  currentUser: (): Promise<{
    username: string | null
    quota: { draftCaseCount: number; allowedDraftCases: number } | null
  }> => ipcRenderer.invoke('api:currentUser'),

  upload: (request: unknown): Promise<{ caseId: string; url: string }> => ipcRenderer.invoke('upload:run', request),

  onProgress: (handler: (p: Progress) => void): (() => void) => {
    const listener = (_e: unknown, p: Progress): void => handler(p)
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type UploaderApi = typeof api
