/** Level-gated logger. The only module allowed to touch console directly. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }

function threshold() {
  const configured = import.meta.env?.VITE_LOG_LEVEL
  if (configured && LEVELS[configured]) return LEVELS[configured]
  return import.meta.env?.DEV ? LEVELS.info : LEVELS.warn
}

function emit(level, args) {
  if (LEVELS[level] < threshold()) return
  console[level === 'debug' ? 'log' : level](...args)
}

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
}
