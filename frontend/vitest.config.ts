import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/** Test-only config — no Tailwind plugin (we assert DOM/behaviour, not styles). */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
