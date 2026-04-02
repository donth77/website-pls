type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

function emit(
  level: LogLevel,
  component: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...extra,
  };

  const json = JSON.stringify(entry);
  if (level === "error") {
    console.error(json);
  } else if (level === "warn") {
    console.warn(json);
  } else {
    console.log(json);
  }
}

/** Create a logger scoped to a component (e.g. "orchestrator", "worker"). */
export function createLogger(
  component: string,
  defaultExtra?: Record<string, unknown>,
) {
  return {
    info(message: string, extra?: Record<string, unknown>) {
      emit("info", component, message, { ...defaultExtra, ...extra });
    },
    warn(message: string, extra?: Record<string, unknown>) {
      emit("warn", component, message, { ...defaultExtra, ...extra });
    },
    error(message: string, extra?: Record<string, unknown>) {
      emit("error", component, message, { ...defaultExtra, ...extra });
    },
    debug(message: string, extra?: Record<string, unknown>) {
      emit("debug", component, message, { ...defaultExtra, ...extra });
    },
    /** Return a child logger with additional default fields (e.g. requestId). */
    child(extra: Record<string, unknown>) {
      return createLogger(component, { ...defaultExtra, ...extra });
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
