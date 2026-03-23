/**
 * Stub for Node.js 'fs' module in the browser/Tauri webview.
 * readFileSync is a no-op stub (synchronous calls can't work in webview).
 * readFileAsync reads a local file via Tauri IPC.
 */
import { invoke } from '@tauri-apps/api/core'

const fs = {
  readFileSync(_path: string, _encoding?: string): string {
    console.debug('[fs.readFileSync — stub]', _path)
    return ''
  },
  readFileAsync(path: string): Promise<string> {
    return invoke<string>('read_text_file', { path })
  },
}

export default fs
export const readFileSync = fs.readFileSync
export const readFileAsync = fs.readFileAsync
