/**
 * Tauri entry point — scaffold placeholder.
 * Step 2 will replace this with the real app.
 */
import React from 'react'
import ReactDOM from 'react-dom'

function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: 32 }}>
      <h1>Medis</h1>
      <p>Tauri scaffold OK ✓</p>
      <button
        onClick={() =>
          import('@tauri-apps/api/core').then(({ invoke }) =>
            invoke<string>('ping').then(alert)
          )
        }
      >
        Ping Rust backend
      </button>
    </div>
  )
}

ReactDOM.render(<App />, document.getElementById('root'))
