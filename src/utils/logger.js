const config = require('../config');

let client = null;
const recentErrors = new Map();

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
    console.log(format('INFO', scope, message, meta));
  },
  warn(scope, message, meta) {
    console.warn(format('WARN', scope, message, meta));
  },
  error(scope, message, meta) {
    const line = format('ERROR', scope, message, meta);
    console.error(line);
    notifyOwners(line);
  },
};
