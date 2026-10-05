const { handleReaction } = require('../../utils/reactionRoleEvents');

module.exports = {
  name: 'messageReactionAdd',
  execute: (reaction, user) => handleReaction(reaction, user, 'add'),
};
