/**
 * Stub for Node.js 'net' module in the browser/Tauri webview.
 * TCP connections are handled by the Rust backend (step 3).
 */
const net = {
  createServer(_handler?: unknown) {
    return {
      listen(_port: number, _cb?: () => void) {},
      address() { return { port: 0 } },
    }
  },
}

export default net
