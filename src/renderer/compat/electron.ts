/**
 * Browser-compatible shim for Electron APIs used in the renderer.
 * Each stub will be replaced with a real Tauri equivalent in the relevant step:
 *   - ipcRenderer.send/on  → step 4 (Tauri invoke + event system)
 *   - remote.dialog        → step 4 (tauri-plugin-dialog)
 *   - remote window.close  → step 4 (Tauri window API)
 *   - clipboard            → navigator.clipboard (works today)
 */

// ── ipcRenderer ─────────────────────────────────────────────────────────────

export const ipcRenderer = {
  send(channel: string, ...args: unknown[]) {
    console.debug('[ipcRenderer.send — stub]', channel, ...args)
  },
  on(_channel: string, _listener: (...args: unknown[]) => void) {
    // Will be replaced with tauri listen() in step 4
  },
}

// ── clipboard ────────────────────────────────────────────────────────────────

export const clipboard = {
  writeText(text: string) {
    navigator.clipboard.writeText(text).catch(console.error)
  },
}

// ── remote ───────────────────────────────────────────────────────────────────

export const remote = {
  getCurrentWindow() {
    return {
      close() {
        // Step 4: import('@tauri-apps/api/window').then(m => m.getCurrentWindow().close())
        console.debug('[remote.getCurrentWindow().close — stub]')
      },
    }
  },

  Menu: {
    buildFromTemplate(_template: unknown[]) {
      // Native context menus are not available in the browser webview.
      // Step 4: replace with a custom React context menu or Tauri menu API.
      return {
        popup() {
          console.debug('[remote.Menu.popup — stub]')
        },
      }
    },
  },

  dialog: {
    showOpenDialog(_win: unknown, _options: unknown): string[] | null {
      // Step 4: replace with tauri-plugin-dialog open()
      console.debug('[remote.dialog.showOpenDialog — stub]')
      return null
    },
  },
}
