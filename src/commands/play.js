const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer, QueueRepeatMode } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const db = require('../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist from YouTube, Spotify, SoundCloud, or Apple Music')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('Song name, or a URL/playlist link').setRequired(true),
    ),

  async execute(interaction) {
    const member = interaction.member;
    const channel = member.voice?.channel;

    if (!channel) {
      return interaction.reply({ embeds: [errorEmbed('Join a voice channel first.')], ephemeral: true });
    }

    const query = interaction.options.getString('query', true);
    const player = useMainPlayer();
    const settings = db.getGuildSettings(interaction.guildId);

    await interaction.deferReply();

    try {
      const { track, queue } = await player.play(channel, query, {
        nodeOptions: {
          metadata: { textChannelId: interaction.channelId },
          volume: settings.defaultVolume,
          leaveOnEmpty: !settings.twentyFourSeven,
          leaveOnEmptyCooldown: 60_000,
          leaveOnEnd: !settings.twentyFourSeven,
          leaveOnEndCooldown: 60_000,
          leaveOnStop: !settings.twentyFourSeven,
          selfDeaf: true,
        },
      });

      if (settings.autoplay) queue.setRepeatMode(QueueRepeatMode.AUTOPLAY);

      return interaction.followUp({
        embeds: [successEmbed(`Queued **${track.title}**`)],
      });
    } catch (err) {
      return interaction.followUp({
        embeds: [errorEmbed(`Couldn't play that: ${err.message || err}`)],
      });
    }
  },
};
