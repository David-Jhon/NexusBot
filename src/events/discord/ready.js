const logger = require('../../utils/logger');
const queueManager = require('../../structures/queueManager');
const config = require('../../config');
const { getInviteUrl } = require('../../utils/invite');

// Shown as the bot's "About Me" (application description, max 400 chars)
function buildDescription(clientId) {
  return [
    `${config.brand.name} — free 24/7 music bot. Use /play to start.`,
    '',
    `Add me to your server: ${getInviteUrl(clientId)}`,
  ].join('\n');
}

async function syncDescription(client) {
  try {
    const app = await client.application.fetch();
    const description = buildDescription(client.user.id);
    if (app.description === description) return;
    await app.edit({ description });
    logger.info('Client', 'Updated application description with invite link');
  } catch (err) {
    logger.warn('Client', 'Failed to update application description', { error: err.message });
  }
}

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info('Client', `Logged in as ${client.user.tag}`);
    client.user.setPresence({
      activities: [{ name: '/play — free 24/7 music' }],
      status: 'online',
    });

    await syncDescription(client);

    // Reconnect recovery: restore any queues that were active before a restart
    await queueManager.rehydrateAllQueues(client);

    // Ongoing safety net for voice connections that die without a clean event
    queueManager.startWatchdog(client);
  },
};
