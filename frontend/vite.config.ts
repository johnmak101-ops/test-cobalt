import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { paveSourceTagger } from './pave-source-tagger.js'

const backendPort = process.env.VITE_BACKEND_PORT ?? '3000'
const frontendPort = parseInt(process.env.VITE_PORT ?? '5173', 10)

export default defineConfig({
  plugins: [paveSourceTagger(), react()],
  server: {
    port: frontendPort,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
