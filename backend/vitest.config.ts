import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

/**
 * SWC (not esbuild) so Nest DI gets `emitDecoratorMetadata` under vitest — required for AppModule
 * NestFactory boot tests. See TODO "e2e AppModule boot test" + Nest SWC recipe.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./test/vitest.setup.ts'],
    // integration specs share one test DB → run serially to avoid truncate races
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
})
