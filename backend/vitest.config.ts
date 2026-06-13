import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./test/vitest.setup.ts'],
    // integration specs share one test DB → run serially to avoid truncate races
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
