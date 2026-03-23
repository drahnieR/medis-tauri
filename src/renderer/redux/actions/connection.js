'use strict';

// Step 3: Node.js dependencies (ioredis, ssh2, net) replaced by Tauri IPC calls
// to the Rust backend. Imports removed to allow Vite to bundle the renderer.
import {createAction} from 'Utils';

function getIndex(getState) {
  const {activeInstanceKey, instances} = getState()
  return instances.findIndex(instance => instance.get('key') === activeInstanceKey)
}

export const updateConnectStatus = createAction('UPDATE_CONNECT_STATUS', status => ({getState, next}) => {
  next({status, index: getIndex(getState)})
})

export const disconnect = createAction('DISCONNECT', () => ({getState, next}) => {
  next({index: getIndex(getState)})
})

// Step 3: connectToRedis will invoke the Rust backend via Tauri IPC.
// The redis client object (currently passed through Redux state) will be
// replaced by a connection handle / instance key returned from Rust.
export const connectToRedis = createAction('CONNECT', _config => ({dispatch, next: _next, getState}) => {
  dispatch(updateConnectStatus('Redis backend not yet implemented — see step 3'))
})
