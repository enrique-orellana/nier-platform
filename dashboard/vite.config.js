import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  const isKubernetes = Boolean(env.KUBERNETES_SERVICE_HOST || env.KUBERNETES_PORT)
  const backendTarget =
    env.VITE_BACKEND_PROXY_TARGET ||
    (isKubernetes ? 'http://openshorts-backend:8000' : 'http://openshorts.127.0.0.1.nip.io')
  const rendererTarget =
    env.VITE_RENDERER_PROXY_TARGET ||
    (isKubernetes ? 'http://openshorts-renderer:3100' : 'http://localhost:3100')

  return {
    plugins: [react()],
    resolve: {
      dedupe: ['mediabunny'],
    },
    optimizeDeps: {
      exclude: ['mediabunny'],
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
    },
  server: {
    allowedHosts: [
      'openshorts.app',
      'www.openshorts.app',
      'openshorts.127.0.0.1.nip.io',
      'openshorts-frontend'
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
}
})
