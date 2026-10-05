const db = require('../../database/db');

module.exports = {
  name: 'messageDeleteBulk',
  execute(messages) {
    for (const id of messages.keys()) db.deletePanel(id);
  },
};
