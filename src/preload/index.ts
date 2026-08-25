import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AnonResult,
  AppInfo,
  BurnInFinding,
  IngestResult,
  PreviewFrame,
  Progress,
  ReformatPlan,
  ReformatRequestMessage,
  Series,
  StackSelection,
  VolumeInfo
} from '@shared/types'

/** The only surface the renderer has onto the filesystem and the network. */
const api = {
  /** Version, OS and architecture, for the home screen and bug reports. */
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  pickSource: (kind: 'folder' | 'zip'): Promise<string[] | null> => ipcRenderer.invoke('source:pick', kind),
  /**
   * Resolve a dropped File to its path. Electron 32 removed the non-standard
   * File.path property, and this is its documented replacement — it has to run
   * here in the preload, not in the renderer.
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  ingest: (paths: string[]): Promise<IngestResult> => ipcRenderer.invoke('ingest:run', paths),
  resetIngest: (): Promise<void> => ipcRenderer.invoke('ingest:reset'),
  setSelection: (selection: StackSelection[]): Promise<void> => ipcRenderer.invoke('selection:set', selection),
  /**
   * One decoded frame, no larger than `maxEdge`. Whole files never cross this
   * bridge — the card asks for a thumbnail, the viewer for something it can
   * draw a mask on.
   */
  readPreviewFrame: (filePath: string, frame: number, maxEdge?: number): Promise<PreviewFrame> =>
    ipcRenderer.invoke('preview:frame', filePath, frame, maxEdge),
  /**
   * Look for text burnt into the pixels of the selection. Only stacks something
   * was noticed in come back; silence about a stack is not a clean bill.
   */
  scanBurnIn: (): Promise<BurnInFinding[]> => ipcRenderer.invoke('burnIn:scan'),

  /**
   * Reformatting. The volume is built and held in the main process — a chest CT
   * is hundreds of megabytes — and only preview-sized frames of it come back.
   */
  openVolume: (stackId: string): Promise<VolumeInfo> => ipcRenderer.invoke('volume:open', stackId),
  reformatFrame: (request: ReformatRequestMessage, maxEdge: number): Promise<PreviewFrame> =>
    ipcRenderer.invoke('volume:frame', request, maxEdge),
  reformatCount: (plan: ReformatPlan): Promise<number> => ipcRenderer.invoke('volume:count', plan),
  commitReformat: (plan: ReformatPlan): Promise<{ studyId: string; series: Series }> =>
    ipcRenderer.invoke('volume:commit', plan),
  closeVolume: (): Promise<void> => ipcRenderer.invoke('volume:close'),
  anonymise: (): Promise<AnonResult & { summary: { tag: string; text: string; level: number; count: number }[] }> =>
    ipcRenderer.invoke('anon:run'),

  configureAuth: (config: {
    clientId: string
    clientSecret?: string
    redirectUri: string
    scope?: string
  }): Promise<void> =>
    ipcRenderer.invoke('auth:configure', config),
  authStatus: (): Promise<{
    configured: boolean
    authenticated: boolean
    redirectUri: string | null
    clientId: string | null
    scope: string | null
    usesOutOfBandFlow: boolean
  }> => ipcRenderer.invoke('auth:status'),
  /** Opens the authorization page. needsCode marks the out-of-band flow. */
  beginSignIn: (): Promise<{ needsCode: boolean }> => ipcRenderer.invoke('auth:beginSignIn'),
  completeSignIn: (
    code: string
  ): Promise<{ username: string | null; quota: { draftCaseCount: number; allowedDraftCases: number | null } | null }> =>
    ipcRenderer.invoke('auth:completeSignIn', code),
  signOut: (): Promise<void> => ipcRenderer.invoke('auth:signOut'),
  currentUser: (): Promise<{
    username: string | null
    quota: { draftCaseCount: number; allowedDraftCases: number | null } | null
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
