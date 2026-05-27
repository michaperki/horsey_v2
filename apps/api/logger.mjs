// Structured logger for the API server.
//
// Two output shapes:
//   - "json"   : one JSON object per line on stdout/stderr. The default in
//                production (or when HORSEY_LOG_FORMAT=json) so a log shipper
//                or external error tracker has a stable schema to attach to.
//   - "pretty" : `LEVEL  message  key=value ...` on a single line. The default
//                outside production so a developer reading `npm run dev`
//                output isn't drowning in JSON.
//
// Env:
//   HORSEY_LOG_FORMAT = "json" | "pretty"   (override the NODE_ENV default)
//   HORSEY_LOG_LEVEL  = "debug" | "info" | "warn" | "error" | "silent"
//                       (default "info"; tests can set "silent" to suppress)

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function envLevel() {
  const raw = (process.env.HORSEY_LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function envFormat() {
  const raw = process.env.HORSEY_LOG_FORMAT;
  if (raw === "json" || raw === "pretty") return raw;
  return process.env.NODE_ENV === "production" ? "json" : "pretty";
}

let activeLevel = envLevel();
let activeFormat = envFormat();

export function setLogLevel(level) {
  const n = typeof level === "string" ? LEVELS[level.toLowerCase()] : null;
  if (n != null) activeLevel = n;
}

export function setLogFormat(format) {
  if (format === "json" || format === "pretty") activeFormat = format;
}

function serializeError(err) {
  if (!err || typeof err !== "object") return err;
  const out = { name: err.name, message: err.message };
  if (err.code) out.code = err.code;
  if (err.status) out.status = err.status;
  if (err.stack) out.stack = err.stack;
  return out;
}

function normalizeFields(fields) {
  if (!fields) return null;
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function formatPretty(level, message, fields) {
  let line = `${level.toUpperCase().padEnd(5)} ${message}`;
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      const rendered =
        typeof value === "string" ? value : JSON.stringify(value);
      line += ` ${key}=${rendered}`;
    }
  }
  return line;
}

function emit(level, message, fields) {
  if (LEVELS[level] < activeLevel) return;
  const normalized = normalizeFields(fields);
  if (activeFormat === "json") {
    const record = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...(normalized || {})
    };
    const line = JSON.stringify(record);
    if (level === "warn" || level === "error") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  } else {
    const line = formatPretty(level, message, normalized);
    if (level === "warn" || level === "error") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  }
}

function makeLogger(bindings) {
  function withBindings(extra) {
    if (!bindings) return extra ?? null;
    if (!extra) return bindings;
    return { ...bindings, ...extra };
  }
  return {
    debug(message, fields) { emit("debug", message, withBindings(fields)); },
    info(message, fields)  { emit("info",  message, withBindings(fields)); },
    warn(message, fields)  { emit("warn",  message, withBindings(fields)); },
    error(message, fields) { emit("error", message, withBindings(fields)); },
    child(extra) { return makeLogger(withBindings(extra)); }
  };
}

export const logger = makeLogger(null);

let requestCounter = 0;
export function nextRequestId() {
  requestCounter = (requestCounter + 1) & 0xffffff;
  return `r${Date.now().toString(36)}${requestCounter.toString(36).padStart(4, "0")}`;
}
