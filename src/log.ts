type LogData = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", event: string, data?: LogData): void {
  const entry = { level, event, ts: new Date().toISOString(), ...data };
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export const log = {
  info: (event: string, data?: LogData) => emit("info", event, data),
  warn: (event: string, data?: LogData) => emit("warn", event, data),
  error: (event: string, data?: LogData) => emit("error", event, data),
};
