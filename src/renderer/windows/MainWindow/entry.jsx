'use strict'

import '../../photon/css/photon.min.css'
import 'fixed-data-table-contextmenu/dist/fixed-data-table.css'
import '../../styles/global.scss'

import ReactDOM from 'react-dom'
import $ from 'jquery'
import { Buffer } from 'buffer'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import MainWindow from './'

window.$ = window.jQuery = $
window.Buffer = Buffer

// Suppress the WKWebView default context menu (Tauri's native menu API is used instead)
window.addEventListener('contextmenu', e => { e.preventDefault() })

// Persist and restore window size
;(async () => {
  const win = getCurrentWindow()
  const saved = localStorage.getItem('windowSize')
  if (saved) {
    const {width, height} = JSON.parse(saved)
    await win.setSize(new LogicalSize(width, height))
  }
  let saveTimer
  window.addEventListener('resize', () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      localStorage.setItem('windowSize', JSON.stringify({
        width: window.innerWidth,
        height: window.innerHeight,
      }))
    }, 500)
  })
})()

// Step 4: replace with tauri listen('action', ...) to receive events from
// the Rust backend (e.g. when another window triggers a Redux action).
// ipcRenderer.on('action', (evt, action) => { store.dispatch(actions[action]()) })

ReactDOM.render(MainWindow, document.body.appendChild(document.createElement('div')))
