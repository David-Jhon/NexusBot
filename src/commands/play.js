const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer, QueueRepeatMode } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { resolveQuery } = require('../utils/queryResolver');
const logger = require('../utils/logger');
const db = require('../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist from YouTube, Spotify, SoundCloud, Deezer, or Apple Music')
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

    // Unshorten Deezer short links (link.deezer.com/s/... → deezer.com/track/...)
    let resolvedQuery = query;
    if (query.includes('link.deezer.com') || query.includes('dzr.page.link')) {
      try {
        const response = await fetch(query, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(7000),
        });
        const { origin, pathname } = new URL(response.url);
        resolvedQuery = origin + pathname;
        logger.info('Play', 'Deezer URL unshortened', { from: query.slice(0, 60), to: resolvedQuery.slice(0, 60) });
      } catch (err) {
        logger.warn('Play', 'Failed to unshorten Deezer URL, using original', { err: err.message });
      }
    }

    try {
      const resolved = await resolveQuery(resolvedQuery);

      if (resolved.error) {
        return interaction.followUp({ embeds: [errorEmbed(resolved.error)] });
      }

      logger.info('Play', 'Query resolved', {
        query: resolvedQuery.slice(0, 80),
        isUrl: resolved.isUrl,
        extractor: resolved.extractor?.identifier || 'auto',
        canStream: resolved.canStream,
        type: resolved.type,
      });

      // Force Deezer extractor for Deezer URLs (attachmentextractor has higher priority and would steal it)
      const isDeezerUrl = resolvedQuery.includes('deezer.com') || resolvedQuery.includes('dzr.page.link');
      const playOptions = {
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
      };
      if (isDeezerUrl) {
        playOptions.searchEngine = 'ext:com.retrouser955.discord-player.deezr-ext';
      }

      const { track, queue } = await player.play(channel, resolvedQuery, playOptions);

      if (settings.autoplay) queue.setRepeatMode(QueueRepeatMode.AUTOPLAY);

      const isFirst = queue.tracks.size === 0 && !queue.currentTrack;
      const verb = isFirst ? 'Now playing' : 'Queued';

      return interaction.followUp({
        embeds: [successEmbed(`${verb} **${track.title}**`)],
      });
    } catch (err) {
      const msg = err.message || String(err);

      if (msg.includes('Could not extract')) {
        return interaction.followUp({
          embeds: [errorEmbed('Extraction failed. The source may be unsupported or the URL may be invalid.')],
        });
      }
      if (msg.includes('No results')) {
        return interaction.followUp({
          embeds: [errorEmbed('No results found for that query.')],
        });
      }
      if (msg.includes('This video is private')) {
        return interaction.followUp({
          embeds: [errorEmbed('That video is private or unavailable.')],
        });
      }
      if (msg.includes('age-restricted')) {
        return interaction.followUp({
          embeds: [errorEmbed('Age-restricted content cannot be played.')],
        });
      }

      logger.error('Play', 'Playback failed', { query: resolvedQuery.slice(0, 80), err: msg });
      return interaction.followUp({
        embeds: [errorEmbed(`Couldn't play that: ${msg.slice(0, 200)}`)],
      });
    }
  },
};
