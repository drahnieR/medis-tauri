import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],

  // Polyfill Node.js globals that the old Electron renderer code relied on
  define: {
    global: 'globalThis',
    'process.env': {},
    'process.browser': true,
    'process.version': '"v16.0.0"',
  },

  resolve: {
    alias: {
      // App path aliases (matching old webpack config)
      Redux: resolve(__dirname, 'src/renderer/redux'),
      Utils: resolve(__dirname, 'src/renderer/utils'),

      // Electron API shim — all `import ... from 'electron'` resolve here
      electron: resolve(__dirname, 'src/renderer/compat/electron.ts'),

      // Node.js built-in stubs — real logic lives in the Rust backend (step 3)
      fs: resolve(__dirname, 'src/renderer/compat/node-fs.ts'),
      net: resolve(__dirname, 'src/renderer/compat/node-net.ts'),

      // jsonlint CLI-only deps (were webpack externals: '{}')
      file: resolve(__dirname, 'src/renderer/compat/empty.ts'),
      system: resolve(__dirname, 'src/renderer/compat/empty.ts'),
    },
  },
  root: '.',
  publicDir: 'resources',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  // Tauri dev server settings
  clearScreen: false,
  server: {
    host: host || false,
    port: 5173,
    strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 5183 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
