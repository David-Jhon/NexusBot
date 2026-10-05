const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { resolveQuery } = require('../utils/queryResolver');
const { YOUTUBE_ENGINE, buildPlayOptions, applyGuildAutoplay } = require('../utils/playback');
const logger = require('../utils/logger');

// Autocomplete must answer within 3s, so cache recent searches and cap the wait
const SUGGEST_TIMEOUT_MS = 2_500;
const SUGGEST_CACHE_TTL_MS = 5 * 60_000;
const SUGGEST_CACHE_MAX = 200;
const suggestCache = new Map();

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function searchSuggestions(query) {
  const key = query.toLowerCase();
  const cached = suggestCache.get(key);
  if (cached && Date.now() - cached.at < SUGGEST_CACHE_TTL_MS) return cached.choices;

  let timer;
  const result = await Promise.race([
    useMainPlayer().search(query, { searchEngine: YOUTUBE_ENGINE }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Search timed out')), SUGGEST_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));

  const choices = result.tracks
    .filter((track) => track.url && track.url.length <= 100)
    .slice(0, 10)
    .map((track) => ({
      name: truncate(`${track.title} — ${track.author} (${track.duration})`, 100),
      value: track.url,
    }));

  if (suggestCache.size >= SUGGEST_CACHE_MAX) suggestCache.delete(suggestCache.keys().next().value);
  suggestCache.set(key, { at: Date.now(), choices });
  return choices;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist from YouTube, Spotify, SoundCloud, Deezer, or Apple Music')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Song name, or a URL/playlist link')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().trim();

    // Nothing useful to suggest for very short input or pasted links
    if (query.length < 2 || /^https?:\/\//i.test(query)) {
      return interaction.respond([]).catch(() => null);
    }

    try {
      const choices = await searchSuggestions(query);
      await interaction.respond(choices);
    } catch (err) {
      logger.warn('Play', 'Autocomplete search failed', { query: query.slice(0, 80), err: err.message });
      await interaction.respond([]).catch(() => null);
    }
  },

  async execute(interaction) {
    const member = interaction.member;
    const channel = member.voice?.channel;

    if (!channel) {
      return interaction.reply({ embeds: [errorEmbed('Join a voice channel first.')], ephemeral: true });
    }

    const query = interaction.options.getString('query', true);
    const player = useMainPlayer();

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

      const { track, queue, searchResult } = await player.play(
        channel,
        resolvedQuery,
        buildPlayOptions(interaction.guildId, {
          query: resolvedQuery,
          requestedBy: interaction.user,
          textChannelId: interaction.channelId,
        }),
      );

      applyGuildAutoplay(queue);

      // player.play waits for playback to start, so the new track is already current if nothing else was
      const verb = queue.currentTrack === track ? 'Now playing' : 'Queued';
      const playlist = searchResult?.playlist;
      const text = playlist
        ? `Queued **${searchResult.tracks.length}** tracks from **${playlist.title}**`
        : `${verb} **${track.title}**`;

      return interaction.followUp({ embeds: [successEmbed(text)] });
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
