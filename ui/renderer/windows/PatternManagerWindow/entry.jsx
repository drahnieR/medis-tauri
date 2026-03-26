'use strict'

import '../../photon/css/photon.min.css'

import React from 'react'
import ReactDOM from 'react-dom'
import {Provider} from 'react-redux'
import PatternManagerWindow from './'
import store from 'Redux/store'
import * as actions from 'Redux/actions'
import $ from 'jquery'
import '../../styles/global.scss'

window.$ = window.jQuery = $

// Step 4: wire up tauri listen() for cross-window actions

ReactDOM.render(
  <Provider store={store}>
    <PatternManagerWindow/>
  </Provider>,
  document.body.appendChild(document.createElement('div'))
)
