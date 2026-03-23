/**
 * Stub for Node.js 'fs' module in the browser/Tauri webview.
 * Step 4: replace readFileSync usages in Config/index.jsx with
 * tauri-plugin-fs + tauri-plugin-dialog (async file picker).
 */
const fs = {
  readFileSync(_path: string, _encoding?: string): string {
    console.debug('[fs.readFileSync — stub]', _path)
    return ''
  },
}

export default fs
export const readFileSync = fs.readFileSync
