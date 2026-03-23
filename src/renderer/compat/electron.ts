/**
 * Browser-compatible shim for Electron APIs used in the renderer.
 *   - ipcRenderer.send/on  → step 4 (Tauri invoke + event system)
 *   - remote.dialog        → step 4 (tauri-plugin-dialog)
 *   - remote window.close  → step 4 (Tauri window API)
 *   - clipboard            → navigator.clipboard (works today)
 *   - remote.Menu          → @tauri-apps/api/menu native context menu
 */

import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'

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
    buildFromTemplate(template: Array<{ label?: string; type?: string; click?: () => void }>) {
      // Build items asynchronously; store the promise so popup() can await it.
      const menuPromise = Promise.all(
        template.map(item => {
          if (item.type === 'separator') {
            return PredefinedMenuItem.new({ item: 'Separator' })
          }
          return MenuItem.new({ text: item.label ?? '', action: item.click ?? (() => {}) })
        })
      ).then(items => Menu.new({ items }))

      return {
        popup(_win?: unknown) {
          menuPromise.then(menu => menu.popup()).catch(console.error)
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
