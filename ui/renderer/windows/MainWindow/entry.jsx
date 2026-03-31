'use strict'

import '../../photon/css/photon.min.css'
import 'fixed-data-table-2/dist/fixed-data-table.css'
import '../../styles/global.scss'

import ReactDOM from 'react-dom'
import $ from 'jquery'
import { Buffer } from 'buffer'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import MainWindow from './'

window.$ = window.jQuery = $
window.Buffer = Buffer

// Suppress the WKWebView default context menu (Tauri's native menu API is used instead)
window.addEventListener('contextmenu', e => { e.preventDefault() })

// Show the window (Rust already applied the saved size before this runs)
;(async () => {
  const win = getCurrentWindow()
  await win.show()
  await win.setFocus()
  let saveTimer
  const saveState = async () => {
    const pos = await win.outerPosition()
    invoke('save_window_size', {
      width: window.innerWidth,
      height: window.innerHeight,
      x: pos.x,
      y: pos.y,
    }).catch(console.error)
  }
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveState, 500)
  }
  window.addEventListener('resize', scheduleSave)
  win.listen('tauri://move', scheduleSave)
})()

// Step 4: replace with tauri listen('action', ...) to receive events from
// the Rust backend (e.g. when another window triggers a Redux action).
// ipcRenderer.on('action', (evt, action) => { store.dispatch(actions[action]()) })

ReactDOM.render(MainWindow, document.body.appendChild(document.createElement('div')))
