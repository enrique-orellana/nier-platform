import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST || process.env.KUBERNETES_PORT)
const backendTarget =
  process.env.VITE_BACKEND_PROXY_TARGET ||
  (isKubernetes ? 'http://openshorts-backend:8000' : 'http://backend:8000')
const rendererTarget =
  process.env.VITE_RENDERER_PROXY_TARGET ||
  (isKubernetes ? 'http://openshorts-renderer:3100' : 'http://renderer:3100')

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'openshorts.app',
      'www.openshorts.app',
      'openshorts.127.0.0.1.nip.io'
    ],
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/videos': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/thumbnails': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/gallery': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/video': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/render': {
        target: rendererTarget,
        changeOrigin: true,
      }
    }
  }
})
