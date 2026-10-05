const db = require('../../database/db');
const logger = require('../../utils/logger');
const { fetchPanelMessage, refreshPanel, clearPanelReaction } = require('../../utils/reactionRoles');

module.exports = {
  name: 'roleDelete',
  async execute(role) {
    const removed = db.removeRoleEverywhere(role.id);

    // Redraw affected panels so the deleted role (and its reaction) disappears from them
    for (const mapping of removed) {
      const panel = db.getPanel(mapping.messageId);
      if (!panel) continue;
      try {
        const { message } = await fetchPanelMessage(role.guild, panel);
        if (!message) continue;
        if (panel.style === 'reaction' && mapping.emojiKey) {
          await clearPanelReaction(message, mapping.emojiKey, role.client.user.id);
        }
        await refreshPanel(role.guild, panel, message);
      } catch (err) {
        logger.warn('ReactionRoles', 'Failed to refresh panel after role delete', {
          messageId: mapping.messageId,
          err: err.message,
        });
      }
    }
  },
};
