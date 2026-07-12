const { SlashCommandBuilder } = require('discord.js');
const { useQueue, QueueRepeatMode } = require('discord-player');
const db = require('../database/db');
const { successEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay (keeps related music playing when the queue ends)')
    .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable or disable').setRequired(true)),

  async execute(interaction) {
    const enabled = interaction.options.getBoolean('enabled', true);
    db.updateGuildSettings(interaction.guildId, { autoplay: enabled });

    const queue = useQueue(interaction.guildId);
    if (queue) {
      queue.setRepeatMode(enabled ? QueueRepeatMode.AUTOPLAY : QueueRepeatMode.OFF);
    }

    return interaction.reply({
      embeds: [successEmbed(`Autoplay ${enabled ? 'enabled' : 'disabled'}.`)],
    });
  },
};
