/**
 * TauriRedisClient — drop-in ioredis replacement that routes every call
 * through Tauri IPC to the Rust Redis backend.
 *
 * Supports both callback and Promise APIs, matching ioredis semantics.
 */

import { invoke } from '@tauri-apps/api/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a raw result from Rust to a JS Buffer.
 *  Rust returns BulkString as a UTF-8 string when valid, or as an array of
 *  byte numbers when the bytes are not valid UTF-8. */
function toBuffer(val) {
  if (val === null || val === undefined) return null
  if (Array.isArray(val)) return Buffer.from(val)
  if (typeof val === 'string') return Buffer.from(val, 'utf8')
  return val
}

/** Wrap a Promise to also support a trailing callback, ioredis style. */
function withCallback(promise, callback) {
  if (callback) {
    promise.then(r => callback(null, r)).catch(err => callback(err instanceof Error ? err : new Error(String(err))))
  }
  return promise
}

/** Pluck an optional trailing callback from a rest-args array (mutates). */
function extractCallback(args) {
  if (args.length && typeof args[args.length - 1] === 'function') {
    return args.pop()
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Pipeline / Multi
// ---------------------------------------------------------------------------

class Pipeline {
  constructor(connectionId, atomic = false) {
    this._id = connectionId
    this._atomic = atomic
    this._cmds = []
  }

  _add(command, args) {
    this._cmds.push({ command: command.toUpperCase(), args: args.map(a => (a === null || a === undefined) ? '' : a) })
    return this
  }

  // Standard commands needed in the codebase
  type(key)                    { return this._add('TYPE',   [key]) }
  pttl(key)                    { return this._add('PTTL',   [key]) }
  object(sub, key)             { return this._add('OBJECT', [sub, key]) }
  strlen(key)                  { return this._add('STRLEN', [key]) }
  hlen(key)                    { return this._add('HLEN',   [key]) }
  llen(key)                    { return this._add('LLEN',   [key]) }
  scard(key)                   { return this._add('SCARD',  [key]) }
  zcard(key)                   { return this._add('ZCARD',  [key]) }
  get(key)                     { return this._add('GET',    [key]) }
  set(key, value)              { return this._add('SET',    [key, value]) }
  srem(key, ...members)        { return this._add('SREM',   [key, ...members]) }
  sadd(key, ...members)        { return this._add('SADD',   [key, ...members]) }
  zrem(key, ...members)        { return this._add('ZREM',   [key, ...members]) }
  zadd(key, ...scoreMembers)   { return this._add('ZADD',   [key, ...scoreMembers.map(String)]) }
  config(sub, ...args)         { return this._add('CONFIG', [sub, ...args]) }

  exec(callback) {
    const promise = invoke('redis_pipeline', {
      connectionId: this._id,
      commands: this._cmds,
      atomic: this._atomic,
    }).then(results => results.map(r => [null, r]))
    return withCallback(promise, callback)
  }
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

export class TauriRedisClient {
  constructor(connectionId) {
    this._id = connectionId
    this._listeners = {}
    this.serverInfo = {}
  }

  // -------------------------------------------------------------------------
  // Internal execution helpers
  // -------------------------------------------------------------------------

  _exec(command, args, binary = false) {
    return invoke('redis_execute', {
      connectionId: this._id,
      command: command.toUpperCase(),
      args: args.map(a => (a === null || a === undefined) ? '' : a),
      binary,
    })
  }

  // -------------------------------------------------------------------------
  // Events (minimal — used for 'select' notifications in Terminal/Config)
  // -------------------------------------------------------------------------

  on(event, listener) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(listener)
    return this
  }

  removeAllListeners(event) {
    if (event) delete this._listeners[event]
    else this._listeners = {}
    return this
  }

  emit(event, ...args) {
    ;(this._listeners[event] || []).forEach(l => l(...args))
  }

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  /** Returns a new client that shares the same underlying connection. */
  duplicate() {
    const dup = new TauriRedisClient(this._id)
    dup.serverInfo = this.serverInfo
    return dup
  }

  disconnect() {
    invoke('redis_disconnect', { connectionId: this._id }).catch(console.error)
  }

  select(db) {
    const promise = this._exec('SELECT', [String(db)])
      .then(r => { this.emit('select', db); return r })
    return promise
  }

  // -------------------------------------------------------------------------
  // String commands
  // -------------------------------------------------------------------------

  get(key, callback) {
    return withCallback(this._exec('GET', [key]), callback)
  }

  set(key, value, callback) {
    return withCallback(this._exec('SET', [key, value]), callback)
  }

  /** Like GET but always returns a Buffer (even for valid UTF-8 data). */
  getBuffer(key, callback) {
    return withCallback(
      this._exec('GET', [key], /*binary=*/true).then(toBuffer),
      callback,
    )
  }

  /** SET key value KEEPTTL — preserves existing TTL. */
  setKeepTTL(key, value, callback) {
    return withCallback(this._exec('SET', [key, value, 'KEEPTTL']), callback)
  }

  // -------------------------------------------------------------------------
  // Hash commands
  // -------------------------------------------------------------------------

  hset(key, field, value, callback) {
    return withCallback(this._exec('HSET', [key, field, value]), callback)
  }

  hexists(key, field) { return this._exec('HEXISTS', [key, field]) }
  hsetnx(key, field, value) { return this._exec('HSETNX', [key, field, value]) }

  hdel(key, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('HDEL', [key, ...rest]), callback)
  }

  hscan(key, cursor, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('HSCAN', [key, cursor, ...rest]), callback)
  }

  /** Like HSCAN but returns hash values as Buffers. */
  hscanBuffer(key, cursor, ...rest) {
    const callback = extractCallback(rest)
    const promise = this._exec('HSCAN', [key, cursor, ...rest])
      .then(res => {
        if (Array.isArray(res) && Array.isArray(res[1])) {
          // res = [cursor, [field, value, field, value, ...]]
          // Convert odd-indexed entries (values) to Buffers
          res[1] = res[1].map((item, i) => (i % 2 === 1) ? toBuffer(item) : item)
        }
        return res
      })
    return withCallback(promise, callback)
  }

  // -------------------------------------------------------------------------
  // List commands
  // -------------------------------------------------------------------------

  lset(key, index, value, callback) {
    return withCallback(this._exec('LSET', [key, String(index), value]), callback)
  }

  lrange(key, start, stop, callback) {
    return withCallback(this._exec('LRANGE', [key, String(start), String(stop)]), callback)
  }

  lpush(key, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('LPUSH', [key, ...rest]), callback)
  }

  /**
   * Delete a list element by its index.
   * Uses LSET to replace with a unique sentinel, then LREM to remove it.
   */
  lremindex(key, index) {
    const script = [
      'local tmp = "__LREMIDX_" .. tostring(math.random(999999999)) .. "__"',
      'redis.call("LSET", KEYS[1], ARGV[1], tmp)',
      'return redis.call("LREM", KEYS[1], 1, tmp)',
    ].join('\n')
    return invoke('redis_eval', {
      connectionId: this._id,
      script,
      keys: [key],
      args: [String(index)],
    })
  }

  // -------------------------------------------------------------------------
  // Set commands
  // -------------------------------------------------------------------------

  sadd(key, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('SADD', [key, ...rest]), callback)
  }

  srem(key, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('SREM', [key, ...rest]), callback)
  }

  sscan(key, cursor, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('SSCAN', [key, cursor, ...rest]), callback)
  }

  sismember(key, member) {
    return this._exec('SISMEMBER', [key, member])
  }

  // -------------------------------------------------------------------------
  // Sorted set commands
  // -------------------------------------------------------------------------

  zadd(key, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('ZADD', [key, ...rest.map(String)]), callback)
  }

  zrem(key, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('ZREM', [key, ...rest]), callback)
  }

  zrange(key, start, stop, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('ZRANGE', [key, String(start), String(stop), ...rest]), callback)
  }

  zrevrange(key, start, stop, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('ZREVRANGE', [key, String(start), String(stop), ...rest]), callback)
  }

  zscore(key, member) {
    return this._exec('ZSCORE', [key, member])
  }

  // -------------------------------------------------------------------------
  // Length / cardinality (also in Pipeline, but needed as direct calls)
  // -------------------------------------------------------------------------

  strlen(key, callback) { return withCallback(this._exec('STRLEN', [key]), callback) }
  hlen(key, callback)  { return withCallback(this._exec('HLEN',   [key]), callback) }
  llen(key, callback)  { return withCallback(this._exec('LLEN',   [key]), callback) }
  scard(key, callback) { return withCallback(this._exec('SCARD',  [key]), callback) }
  zcard(key, callback) { return withCallback(this._exec('ZCARD',  [key]), callback) }

  // -------------------------------------------------------------------------
  // Key commands
  // -------------------------------------------------------------------------

  type(key, callback) {
    return withCallback(this._exec('TYPE', [key]), callback)
  }

  del(key, callback) {
    return withCallback(this._exec('DEL', [key]), callback)
  }

  exists(key) {
    return this._exec('EXISTS', [key])
  }

  rename(oldKey, newKey) {
    return this._exec('RENAME', [oldKey, newKey])
  }

  pttl(key, callback) {
    return withCallback(this._exec('PTTL', [key]), callback)
  }

  pexpire(key, ms) {
    return this._exec('PEXPIRE', [key, String(ms)])
  }

  persist(key, callback) {
    return withCallback(this._exec('PERSIST', [key]), callback)
  }

  scan(cursor, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('SCAN', [String(cursor), ...rest]), callback)
  }

  /**
   * Duplicate a key using DUMP + RESTORE.
   * mode: 'TTL' preserves the original TTL, 'NOTTL' sets TTL to 0 (no expiry).
   */
  duplicateKey(srcKey, dstKey, mode) {
    const script = mode === 'TTL'
      ? [
        'local ttl = redis.call("PTTL", KEYS[1])',
        'local dump = redis.call("DUMP", KEYS[1])',
        'if ttl < 0 then ttl = 0 end',
        'redis.call("DEL", KEYS[2])',
        'return redis.call("RESTORE", KEYS[2], ttl, dump)',
      ].join('\n')
      : [
        'local dump = redis.call("DUMP", KEYS[1])',
        'redis.call("DEL", KEYS[2])',
        'return redis.call("RESTORE", KEYS[2], 0, dump)',
      ].join('\n')
    return invoke('redis_eval', {
      connectionId: this._id,
      script,
      keys: [srcKey, dstKey],
      args: [],
    })
  }

  // -------------------------------------------------------------------------
  // Server commands
  // -------------------------------------------------------------------------

  info(callback) {
    return withCallback(this._exec('INFO', []), callback)
  }

  config(sub, ...rest) {
    const callback = extractCallback(rest)
    return withCallback(this._exec('CONFIG', [sub, ...rest]), callback)
  }

  // -------------------------------------------------------------------------
  // Pipeline / transaction
  // -------------------------------------------------------------------------

  pipeline() {
    return new Pipeline(this._id, false)
  }

  multi() {
    return new Pipeline(this._id, true)
  }

  // -------------------------------------------------------------------------
  // Terminal — arbitrary command execution
  // -------------------------------------------------------------------------

  call(...args) {
    const callback = extractCallback(args)
    const [command, ...cmdArgs] = args
    return withCallback(this._exec(command, cmdArgs), callback)
  }

  /**
   * Monitor mode stub — not fully supported in Tauri; returns a no-op object
   * so the Terminal component doesn't crash.
   */
  monitor(callback) {
    const stub = { on() {}, disconnect() {} }
    if (callback) callback(null, stub)
    return Promise.resolve(stub)
  }
}
