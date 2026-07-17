const config = require('../config');

let client = null;
const recentErrors = new Map();

// Suppress noisy YouTube.js warnings
const SUPPRESSED_PATTERNS = [
  'Unable to find matching run for command run',
  'Unable to find matching run for attachment run',
  'Failed to extract signature decipher',
  'Failed to extract n decipher',
];

function isSuppressed(message) {
  return SUPPRESSED_PATTERNS.some(p => message.includes(p));
}

function timestamp() {
  return new Date().toISOString();
}

function format(level, scope, message, meta) {
  const base = `[${timestamp()}] [${level}] [${scope}] ${message}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
}

async function notifyOwners(content) {
  if (!client || !config.ownerIds.length) return;
  const key = content.slice(0, 100);
  if (recentErrors.has(key)) return;
  recentErrors.set(key, true);
  setTimeout(() => recentErrors.delete(key), 30_000);
  for (const id of config.ownerIds) {
    try {
      const user = await client.users.fetch(id);
      await user.send({ content: `**Error:**\n\`\`\`${content.slice(0, 1900)}\`\`\`` });
    } catch {}
  }
}

module.exports = {
  setClient(c) {
    client = c;
  },
  info(scope, message, meta) {
    if (isSuppressed(message)) return;
    console.log(format('INFO', scope, message, meta));
  },
  warn(scope, message, meta) {
    if (isSuppressed(message)) return;
    console.warn(format('WARN', scope, message, meta));
  },
  error(scope, message, meta) {
    if (isSuppressed(message)) return;
    const line = format('ERROR', scope, message, meta);
    console.error(line);
    notifyOwners(line);
  },
};
