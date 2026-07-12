const logger = require('../../utils/logger');
const queueManager = require('../../structures/queueManager');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info('Client', `Logged in as ${client.user.tag}`);
    client.user.setPresence({
      activities: [{ name: '/play — free 24/7 music' }],
      status: 'online',
    });

    // Reconnect recovery: restore any queues that were active before a restart
    await queueManager.rehydrateAllQueues(client);

    // Ongoing safety net for voice connections that die without a clean event
    queueManager.startWatchdog(client);
  },
};
