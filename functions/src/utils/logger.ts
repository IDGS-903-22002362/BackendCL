import { logger as functionsLogger } from "firebase-functions";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const sanitizeContext = (context?: LogContext): LogContext | undefined => {
  if (!context) {
    return undefined;
  }

  const sanitized: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
};

class StructuredLogger {
  constructor(private readonly baseContext: LogContext = {}) {}

  child(context: LogContext): StructuredLogger {
    return new StructuredLogger({ ...this.baseContext, ...sanitizeContext(context) });
  }

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    const payload = {
      message,
      ...this.baseContext,
      ...sanitizeContext(context),
      timestamp: new Date().toISOString(),
    };

    switch (level) {
      case "debug":
        if (process.env.NODE_ENV !== "production") {
          functionsLogger.debug(message, payload);
        }
        break;
      case "info":
        functionsLogger.info(message, payload);
        break;
      case "warn":
        functionsLogger.warn(message, payload);
        break;
      case "error":
        functionsLogger.error(message, payload);
        break;
      default:
        functionsLogger.info(message, payload);
    }
  }
}

export const logger = new StructuredLogger();
export default logger;
