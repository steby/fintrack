import pino from 'pino';
import { randomUUID } from 'crypto';
import { env } from './env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        }
      : undefined,
});

/** Child logger carrying a request id through a request's log lines, for correlation. */
export function requestLogger(requestId: string = randomUUID()) {
  return logger.child({ requestId });
}
