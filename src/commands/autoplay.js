const { SlashCommandBuilder } = require('discord.js');
const { useQueue, QueueRepeatMode } = require('discord-player');
const db = require('../database/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { controlError } = require('../utils/voice');
const queueManager = require('../structures/queueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay (keeps related music playing when the queue ends)')
    .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable or disable').setRequired(true)),

  async execute(interaction) {
    const enabled = interaction.options.getBoolean('enabled', true);
    const queue = useQueue(interaction.guildId);
    const denied = controlError(interaction.member, queue);
    if (denied) return interaction.reply({ embeds: [errorEmbed(denied)], ephemeral: true });

    db.updateGuildSettings(interaction.guildId, { autoplay: enabled });
    if (queue) {
      queue.setRepeatMode(enabled ? QueueRepeatMode.AUTOPLAY : QueueRepeatMode.OFF);
      queueManager.scheduleSnapshot(interaction.guildId);
    }

    return interaction.reply({
      embeds: [successEmbed(`Autoplay ${enabled ? 'enabled' : 'disabled'}.`)],
    });
  },
};
