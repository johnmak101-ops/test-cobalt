import {
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'

/** SQL Server numbers we treat as client/input problems (CHECK / FK / unique / NOT NULL). */
const CONSTRAINT_NUMBERS = new Set([547, 2627, 2601, 515])

/**
 * Pull the SQL Server error number from a tedious/mssql-shaped error (or nested originalError).
 * Do not rely on message text — that can leak constraint names.
 */
export function sqlErrorNumber(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as {
    number?: number
    originalError?: { info?: { number?: number }; number?: number }
  }
  if (typeof e.number === 'number') return e.number
  const nested = e.originalError
  if (nested && typeof nested.number === 'number') return nested.number
  if (nested?.info && typeof nested.info.number === 'number') return nested.info.number
  return undefined
}

type JsonRes = {
  status: (code: number) => { json: (body: unknown) => unknown }
}

/**
 * Global safety net: uncaught SQL constraint failures become HTTP 400 with a non-leaky message
 * instead of a raw 500. {@link HttpException}s keep their status/body. Anything else is a real
 * 500 (logged; body does not echo the stack).
 */
@Catch()
export class DbExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(DbExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<JsonRes>()

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      return res.status(status).json(
        typeof body === 'string' ? { statusCode: status, message: body } : body,
      )
    }

    const n = sqlErrorNumber(exception)
    if (n != null && CONSTRAINT_NUMBERS.has(n)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: "One of the values isn't allowed.",
        error: 'Bad Request',
      })
    }

    this.log.error(
      exception instanceof Error ? exception.stack ?? exception.message : String(exception),
    )
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    })
  }
}
