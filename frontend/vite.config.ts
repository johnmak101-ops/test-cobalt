import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { paveSourceTagger } from './pave-source-tagger.js'

const backendPort = process.env.VITE_BACKEND_PORT ?? '3000'
const frontendPort = parseInt(process.env.VITE_PORT ?? '5173', 10)

export default defineConfig({
  plugins: [paveSourceTagger(), tailwindcss(), react()],
  server: {
    // Bind IPv4+IPv6 so http://127.0.0.1:5173 and http://localhost:5173 both work
    // (default can end up [::1]-only on Windows → "cannot reach" from IPv4).
    host: true,
    port: frontendPort,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
