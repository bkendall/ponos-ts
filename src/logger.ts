export interface Logger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug?(message: string, ...meta: unknown[]): void;
}

export const defaultLogger: Logger = {
  info(message: string, ...meta: unknown[]): void {
    console.log(message, ...meta);
  },
  warn(message: string, ...meta: unknown[]): void {
    console.warn(message, ...meta);
  },
  error(message: string, ...meta: unknown[]): void {
    console.error(message, ...meta);
  },
  debug(message: string, ...meta: unknown[]): void {
    console.debug(message, ...meta);
  },
};

export function resolveLogger(logger?: Partial<Logger>): Logger {
  if (!logger) {
    return defaultLogger;
  }

  return {
    info: logger.info ? logger.info.bind(logger) : defaultLogger.info,
    warn: logger.warn ? logger.warn.bind(logger) : defaultLogger.warn,
    error: logger.error ? logger.error.bind(logger) : defaultLogger.error,
    debug: logger.debug ? logger.debug.bind(logger) : defaultLogger.debug,
  };
}
