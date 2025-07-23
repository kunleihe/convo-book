import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables for the current mode
  const env = loadEnv(mode, process.cwd(), '')

  // Get API URL with fallback to localhost for development
  const API_URL = env.VITE_API_URL || 'http://localhost:8000'

  // Determine WebSocket protocol based on API URL
  const WS_URL = API_URL.replace(/^https?:/, API_URL.startsWith('https') ? 'wss:' : 'ws:')

  console.log(`🔧 Vite Environment: ${mode}`)
  console.log(`🌐 API URL: ${API_URL}`)
  console.log(`🔌 WebSocket URL: ${WS_URL}`)

  return {
    plugins: [react()],
    build: {
      outDir: 'build',
    },
    server: {
      proxy: {
        '/realtime': {
          target: WS_URL,
          ws: true,
          changeOrigin: true,
        },
        '/transcription': {
          target: WS_URL,
          ws: true,
          changeOrigin: true,
        },
        '/health': {
          target: API_URL,
          changeOrigin: true,
        },
        '/api': {
          target: API_URL,
          changeOrigin: true,
        },
      },
    },
  }
})
