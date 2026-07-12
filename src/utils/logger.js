function timestamp() {
  return new Date().toISOString();
}

function format(level, scope, message, meta) {
  const base = `[${timestamp()}] [${level}] [${scope}] ${message}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
}

module.exports = {
  info(scope, message, meta) {
    console.log(format('INFO', scope, message, meta));
  },
  warn(scope, message, meta) {
    console.warn(format('WARN', scope, message, meta));
  },
  error(scope, message, meta) {
    console.error(format('ERROR', scope, message, meta));
  },
};
