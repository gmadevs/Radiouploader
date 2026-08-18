/// <reference types="vite/client" />
import type { UploaderApi } from '../../preload'

declare global {
  interface Window {
    api: UploaderApi
  }
}
