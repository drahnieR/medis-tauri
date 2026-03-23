/**
 * Browser-compatible shim for Electron APIs used in the renderer.
 *   - ipcRenderer.send/on  → cross-window IPC no longer needed (single window)
 *   - remote.dialog        → @tauri-apps/plugin-dialog
 *   - remote window.close  → @tauri-apps/api/window
 *   - clipboard            → navigator.clipboard (works today)
 *   - remote.Menu          → @tauri-apps/api/menu native context menu
 */

import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'

// ── ipcRenderer ─────────────────────────────────────────────────────────────

export const ipcRenderer = {
  send(channel: string, ...args: unknown[]) {
    // Cross-window IPC is not needed in single-window Tauri app.
    console.debug('[ipcRenderer.send — no-op]', channel, ...args)
  },
  on(_channel: string, _listener: (...args: unknown[]) => void) {
    // no-op
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
        getCurrentWindow().close().catch(console.error)
      },
    }
  },

  Menu: {
    buildFromTemplate(template: Array<{ label?: string; type?: string; click?: () => void }>) {
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
    /** Returns a Promise resolving to an array of selected file paths, or null. */
    async showOpenDialog(
      _win: unknown,
      options: { properties?: string[]; message?: string } = {},
    ): Promise<string[] | null> {
      const multiple = options.properties?.includes('multiSelections') ?? false
      const result = await openDialog({ multiple, directory: false, title: options.message })
      if (!result) return null
      return Array.isArray(result) ? result : [result]
    },
  },
}
