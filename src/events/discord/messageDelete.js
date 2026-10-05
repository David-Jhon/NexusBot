const db = require('../../database/db');
const logger = require('../../utils/logger');

// Works for uncached messages too (Partials.Message): only the ID is needed
module.exports = {
  name: 'messageDelete',
  execute(message) {
    if (db.deletePanel(message.id)) {
      logger.info('ReactionRoles', 'Panel message deleted, removed panel', { messageId: message.id });
    }
  },
};
