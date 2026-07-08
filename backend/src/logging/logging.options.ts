import type { Params } from 'nestjs-pino'
import type { TransportTargetOptions } from 'pino'

/**
 * Structured logging config for the tracking backend (pino, via nestjs-pino).
 *
 * Emits JSON to stdout (pretty-printed in dev) AND to a rotating file (via pino-roll: daily / 20MB roll,
 * 14 files kept) — so `logs/backend.<date>.<n>.log` always ends in `.log` and never grows unbounded, the
 * way the old 100MB `pave.log` did. pino-http adds a per-request `req.id` correlation id plus
 * method/url/status/latency for every HTTP call, all threaded through the same logger.
 *
 * LOG_LEVEL sets verbosity (default info). LOG_FILE overrides the file base path; set LOG_FILE= (empty)
 * to log to stdout only. In prod (NODE_ENV=production) stdout is raw JSON for a log shipper; in dev it is
 * pretty-printed.
 */
export function loggerParams(): Params {
  const level = process.env.LOG_LEVEL ?? 'info'
  // 'silent' means log nothing — skip the transport entirely. Besides being less wasteful, this
  // avoids spawning a pino transport worker thread, which crashes when the app is booted inside a
  // test runner's own worker (used by the AppModule boot spec).
  if (level === 'silent') return { pinoHttp: { level: 'silent' } }
  const isProd = process.env.NODE_ENV === 'production'
  const logFile = process.env.LOG_FILE ?? 'logs/backend'

  const targets: TransportTargetOptions[] = [
    isProd
      ? { target: 'pino/file', options: { destination: 1 } } // raw JSON → stdout (for the log shipper)
      : { target: 'pino-pretty', options: { singleLine: false, translateTime: 'SYS:standard' } },
  ]
  if (logFile) {
    targets.push({
      target: 'pino-roll',
      options: {
        file: logFile,
        frequency: 'daily',
        size: '20m',
        mkdir: true,
        dateFormat: 'yyyy-MM-dd',
        limit: { count: 14 }, // ~2 weeks of daily files — bounds growth
      },
    })
  }

  return {
    pinoHttp: {
      level,
      // never write credentials that ride in headers into the logs
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      transport: { targets },
    },
  }
}
