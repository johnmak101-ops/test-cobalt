import type { LoggerService } from '@nestjs/common'
import pino from 'pino'

/** A NestJS LoggerService backed by pino — structured JSON logs for the tracking backend. Wired via
 *  app.useLogger() in main.ts (not DI-injected), so it takes an optional pino instance for unit-testing the
 *  level mapping. LOG_LEVEL controls verbosity (default info). Mirrors the queue's PinoLoggerService so both
 *  halves of the pipeline emit the same structured shape. */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: pino.Logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message))
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, String(message))
  }
  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message))
  }
  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message))
  }
  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message))
  }
}
