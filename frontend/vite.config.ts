import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { paveSourceTagger } from './pave-source-tagger.js'

const backendPort = process.env.VITE_BACKEND_PORT ?? '3000'
const frontendPort = parseInt(process.env.VITE_PORT ?? '5173', 10)

export default defineConfig({
  plugins: [paveSourceTagger(), tailwindcss(), react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Recharts (and the d3 modules it pulls in) is ~147 kB gzipped — it roughly doubled the
         * single bundle when the dashboard pipeline chart landed, which tripped Vite's 500 kB chunk
         * warning. Split out so it is cached independently of app code: a normal deploy changes the
         * app chunk and leaves this one untouched in every operator's browser, instead of forcing a
         * re-download of the charting library because a button label moved.
         */
        manualChunks: { charts: ['recharts'] },
      },
    },
  },
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
