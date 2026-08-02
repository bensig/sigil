import { defineConfig, Plugin, Connect } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'
import fs from 'fs'
import path from 'path'

// Plugin to save JSON files, available under both `vite` (dev) and
// `vite preview` (npm start) so the app is fully usable without a dev server.
function registerSaveEndpoints(middlewares: Connect.Server) {
  function getWalletId(req: any): string | null {
    const url = new URL(req.url || '', 'http://localhost')
    const wallet = url.searchParams.get('wallet')
    if (!wallet || !/^[a-z0-9-]+$/.test(wallet)) return null
    return wallet
  }

  // Save address labels
  middlewares.use('/api/save-labels', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }

    const walletId = getWalletId(req)
    if (!walletId) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Missing or invalid wallet parameter' }))
      return
    }

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const filePath = path.resolve(__dirname, `src/data/${walletId}/address-labels.json`)
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true }))
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
  })

  // Save recipient whitelist
  middlewares.use('/api/save-whitelist', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }

    const walletId = getWalletId(req)
    if (!walletId) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Missing or invalid wallet parameter' }))
      return
    }

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const filePath = path.resolve(__dirname, `src/configs/${walletId}/recipients.json`)
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true }))
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
  })

  // Save wallet config
  middlewares.use('/api/save-config', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }

    const walletId = getWalletId(req)
    if (!walletId) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Missing or invalid wallet parameter' }))
      return
    }

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const filePath = path.resolve(__dirname, `src/configs/${walletId}/config.json`)
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true }))
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
  })
}

function fileSaver(): Plugin {
  return {
    name: 'file-saver',
    configureServer(server) {
      registerSaveEndpoints(server.middlewares)
    },
    configurePreviewServer(server) {
      registerSaveEndpoints(server.middlewares)
    },
  }
}

export default defineConfig({
  plugins: [
    nodePolyfills({
      protocolImports: true,
      globals: {
        Buffer: true,
        process: true,
      },
    }),
    wasm(),
    react(),
    fileSaver(),
  ],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['bitbox-api'],
    esbuildOptions: {
      // Fix for readable-stream in hash-base: sets process.browser=true so it
      // short-circuits past the process.version.slice() check that fails in browsers
      define: {
        'process.browser': 'true',
      },
    },
  },
  build: {
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  resolve: {
    alias: {
      stream: 'stream-browserify',
    },
  },
  server: {
    proxy: {
      '/api/mempool': {
        target: 'https://mempool.space',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/mempool/, '/api'),
      },
      '/api/blockstream': {
        target: 'https://blockstream.info',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/blockstream/, '/api'),
      },
    },
  },
  preview: {
    proxy: {
      '/api/mempool': {
        target: 'https://mempool.space',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/mempool/, '/api'),
      },
      '/api/blockstream': {
        target: 'https://blockstream.info',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/blockstream/, '/api'),
      },
    },
  },
})
