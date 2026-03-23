'use strict'

import '../../photon/css/photon.min.css'
import 'fixed-data-table-contextmenu/dist/fixed-data-table.css'
import '../../styles/global.scss'

import ReactDOM from 'react-dom'
import $ from 'jquery'
import { Buffer } from 'buffer'
import MainWindow from './'

window.$ = window.jQuery = $
window.Buffer = Buffer

// Step 4: replace with tauri listen('action', ...) to receive events from
// the Rust backend (e.g. when another window triggers a Redux action).
// ipcRenderer.on('action', (evt, action) => { store.dispatch(actions[action]()) })

ReactDOM.render(MainWindow, document.body.appendChild(document.createElement('div')))
