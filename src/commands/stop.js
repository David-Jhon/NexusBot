const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const queueManager = require('../structures/queueManager');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }

    queue.delete();
    queueManager.clearSnapshot(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('Stopped and cleared the queue.')] });
  },
};
