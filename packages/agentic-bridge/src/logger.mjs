/** Minimal logger for Node/Electron main — avoids @ludecker/utils TS export at runtime. */

const LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function isLoggingEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.DEBUG === "true";
}

function formatMessage(level, moduleName, operation, message, context) {
  const prefix = `[${level}] [${moduleName}:${operation}] ${message}`;
  if (!context || Object.keys(context).length === 0) {
    return prefix;
  }
  return `${prefix} ${JSON.stringify(context)}`;
}

function writeLog(level, moduleName, operation, message, context) {
  if (!isLoggingEnabled()) {
    return;
  }

  const formatted = formatMessage(level, moduleName, operation, message, context);

  try {
    switch (level) {
      case "debug":
        console.debug(formatted);
        break;
      case "info":
        console.info(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        break;
    }
  } catch {
    // Logging failures must never crash the application.
  }
}

function resolveMinLevel() {
  const configured = process.env.LOG_LEVEL;
  if (configured && configured in LOG_LEVEL_PRIORITY) {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export function createLogger(moduleName, minLevel) {
  const minPriority = LOG_LEVEL_PRIORITY[minLevel ?? resolveMinLevel()];

  const logAtLevel = (level) => (operation, message, context) => {
    if (LOG_LEVEL_PRIORITY[level] < minPriority) {
      return;
    }
    writeLog(level, moduleName, operation, message, context);
  };

  return {
    debug: logAtLevel("debug"),
    info: logAtLevel("info"),
    warn: logAtLevel("warn"),
    error: logAtLevel("error"),
  };
}
