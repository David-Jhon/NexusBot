const { handleReaction } = require('../../utils/reactionRoleEvents');

module.exports = {
  name: 'messageReactionRemove',
  execute: (reaction, user) => handleReaction(reaction, user, 'remove'),
};
