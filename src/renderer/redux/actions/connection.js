'use strict'

import { invoke } from '@tauri-apps/api/core'
import { TauriRedisClient } from '../../tauri_redis.js'
import { createAction } from 'Utils'

function getIndex(getState) {
  const { activeInstanceKey, instances } = getState()
  return instances.findIndex(instance => instance.get('key') === activeInstanceKey)
}

export const updateConnectStatus = createAction('UPDATE_CONNECT_STATUS', status => ({ getState, next }) => {
  next({ status, index: getIndex(getState) })
})

export const disconnect = createAction('DISCONNECT', () => ({ getState, next }) => {
  const { activeInstanceKey, instances } = getState()
  const index = instances.findIndex(instance => instance.get('key') === activeInstanceKey)
  const redis = instances.getIn([index, 'redis'])
  if (redis) {
    redis.disconnect()
  }
  next({ index })
})

export const connectToRedis = createAction('CONNECT', config => ({ dispatch, next, getState }) => {
  dispatch(updateConnectStatus('Connecting…'))
  invoke('redis_connect', {
    config: {
      host: config.host || 'localhost',
      port: Number(config.port) || 6379,
      password: config.password || null,
      db: Number(config.db) || 0,
    },
  }).then(({ connectionId, serverInfo }) => {
    const index = getIndex(getState)
    const redis = new TauriRedisClient(connectionId)
    redis.serverInfo = serverInfo
    next({ config, redis, index })
  }).catch(err => {
    dispatch(updateConnectStatus(`Connection failed: ${err}`))
  })
})
