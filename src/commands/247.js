const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const db = require('../database/db');
const { successEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('Toggle 24/7 mode (bot stays in voice, never auto-leaves)')
    .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable or disable').setRequired(true)),

  async execute(interaction) {
    const enabled = interaction.options.getBoolean('enabled', true);
    db.updateGuildSettings(interaction.guildId, { twentyFourSeven: enabled });

    // Apply immediately to any currently-active queue for this guild.
    // (New queues created by /play will also pick up the saved setting.)
    const queue = useQueue(interaction.guildId);
    if (queue?.options) {
      queue.options.leaveOnEmpty = !enabled;
      queue.options.leaveOnEnd = !enabled;
      queue.options.leaveOnStop = !enabled;
    }

    return interaction.reply({
      embeds: [successEmbed(`24/7 mode ${enabled ? 'enabled' : 'disabled'}.`)],
    });
  },
};
