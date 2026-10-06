const { nowPlayingEmbed } = require('../../utils/embeds');
const { nowPlayingButtons } = require('../../utils/buttons');
const { clearNpMessage, registerNpMessage, startNpAutoRefresh } = require('../../utils/nowPlayingManager');
const queueManager = require('../../structures/queueManager');
const logger = require('../../utils/logger');
const { useMainPlayer } = require('discord-player');

/**
 * Resolve the text channel to post updates in, using the metadata we
 * attach at play-time (see commands/play.js).
 */
function getTextChannel(queue) {
  const id = queue.metadata?.textChannelId;
  if (!id) return null;
  return queue.channel?.guild?.channels?.cache?.get(id) || null;
}

// A track that "finishes" this soon after starting never produced audio
const EMPTY_STREAM_MS = 2_000;

function registerPlayerEvents(player) {
  const events = player.events;

  events.on('playerStart', async (queue, track) => {
    // Skip votes are per track
    queue.__voteSkips?.clear();
    await clearNpMessage(queue);
    // Store track info for autoplay fallback
    queue.metadata = queue.metadata || {};
    queue.metadata.lastTrack = { title: track.title, author: track.author, url: track.url };
    queue.metadata.startedAt = Date.now();
    queue.metadata.skipped = false;
    const channel = getTextChannel(queue);
    if (channel) {
      try {
        const msg = await channel.send({
          embeds: [nowPlayingEmbed(track, queue)],
          components: nowPlayingButtons(queue),
        });
        registerNpMessage(queue, msg);
        startNpAutoRefresh(queue, msg);
      } catch {}
    }
    queueManager.scheduleSnapshot(queue.guild.id);
  });

  events.on('audioTrackAdd', (queue) => queueManager.scheduleSnapshot(queue.guild.id));
  events.on('audioTracksAdd', (queue) => queueManager.scheduleSnapshot(queue.guild.id));
  events.on('audioTrackRemove', (queue) => queueManager.scheduleSnapshot(queue.guild.id));

  events.on('emptyQueue', (queue) => {
    clearNpMessage(queue);
    queueManager.clearSnapshot(queue.guild.id);
  });

  // AUTOPLAY fallback: if extractor returns 0 tracks, search for similar ones
  events.on('willAutoPlay', async (queue, tracks, resolver) => {
    logger.info('Player', 'Autoplay triggered', {
      guildId: queue.guild.id,
      relatedTracks: tracks.length,
    });

    if (tracks.length > 0) {
      resolver(tracks[0]);
      return;
    }

    const lastTrack = queue.metadata?.lastTrack;
    // Search by artist + "music" for variety (avoids generic single-word results).
    // A track YouTube served without metadata (blocked IP) has neither, so there's nothing to search for.
    const artist = lastTrack?.author?.trim();
    const query = artist ? `${artist} music` : lastTrack?.title?.trim();
    if (query) {
      // Get list of recently played URLs to avoid repeats
      const playedUrls = queue.history?.tracks?.map(t => t.url) || [];
      const lastUrl = lastTrack.url;

      logger.info('Player', 'Autoplay fallback: searching', { query });

      // Subtitle/reaction filter pattern — catches re-uploads, covers, remixes
      const subtitlePattern = /\b(sub|subtitled?|dubbed?|dub|instrumental|karaoke|cover|remix|live|acoustic|piano|slowed|reverb|nightcore|sped\s*up|lyrics?\s*(video|version)?|official\s*(video|audio)?|music\s*video|reaction(\s*(video|compilation))?|the\s*first\s*take|live\s*session|concert|performance|unplugged|from\s*\w|feat\.?|ft\.?|featuring|compilation|greatest\s*hits|best\s*of|collection|bgm|background\s*music|top\s*\d+|music\s*mix|mega\s*mix|megamix|medley|playlist|mixtape|НА\s*РУССКОМ|EN\s*ESPAÑOL|EM\s*PORTUGUÊS|auf\s*deutsch|en\s*français|italiano|한국어|中文|日本語|العربية|हिन्दी|русский)\s*(v\d+)?|[\(\[][^\)\]]*(cover|remix|live|acoustic|piano|slowed|reverb|nightcore|sped|sub|dub|instrumental|karaoke|reaction|the\s*first\s*take|unplugged)[^\)\]]*[\)\]]/i;

      // Check if title is too similar to the last played track
      const isSimilarTitle = (t) => {
        const clean = (s) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
        const a = clean(t.title);
        const b = clean(lastTrack.title);
        const wordsA = new Set(a.split(/\s+/));
        const wordsB = new Set(b.split(/\s+/));
        const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
        return intersection / Math.max(wordsA.size, wordsB.size) > 0.6;
      };

      // Check if track is actually by the same artist
      const isBySameArtist = (t) => {
        if (!artist) return true; // No artist info, accept any track
        const titleLower = t.title.toLowerCase();
        const authorLower = (t.author || '').toLowerCase();
        const artistLower = artist.toLowerCase();
        return titleLower.includes(artistLower) || authorLower.includes(artistLower);
      };

      const isUnique = (t) => t.url !== lastUrl && !playedUrls.includes(t.url) && !subtitlePattern.test(t.title) && !isSimilarTitle(t) && isBySameArtist(t);

      // Try YouTube first (force YouTubeiExtractor to avoid Deezer bridging)
      try {
        const searchPlayer = useMainPlayer();
        const results = await searchPlayer.search(query, {
          searchEngine: 'ext:com.retrouser955.discord-player.discord-player-youtubei',
        });
        if (results?.tracks?.length) {
          const unique = results.tracks.filter(isUnique);
          if (unique.length > 0) {
            logger.info('Player', 'Autoplay fallback: picked YouTube track', { title: unique[0].title });
            resolver(unique[0]);
            return;
          }
        }
      } catch (err) {
        logger.error('Player', 'YouTube autoplay fallback failed', { err: String(err) });
      }

      // YouTube failed — try Spotify as fallback
      try {
        const searchPlayer = useMainPlayer();
        const spotifyResults = await searchPlayer.search(query, {
          searchEngine: 'ext:com.discord-player.itsmaat.spotifyextractor',
        });
        if (spotifyResults?.tracks?.length) {
          const unique = spotifyResults.tracks.filter(isUnique);
          if (unique.length > 0) {
            logger.info('Player', 'Autoplay fallback: picked Spotify track', { title: unique[0].title });
            resolver(unique[0]);
            return;
          }
        }
      } catch (err) {
        logger.error('Player', 'Spotify autoplay fallback failed', { err: String(err) });
      }

      // Spotify failed — try Deezer as last resort
      try {
        const searchPlayer = useMainPlayer();
        const deezerResults = await searchPlayer.search(query, {
          searchEngine: 'ext:com.retrouser955.discord-player.deezr-ext',
        });
        if (deezerResults?.tracks?.length) {
          const unique = deezerResults.tracks.filter(isUnique);
          if (unique.length > 0) {
            logger.info('Player', 'Autoplay fallback: picked Deezer track', { title: unique[0].title });
            resolver(unique[0]);
            return;
          }
        }
      } catch (err) {
        logger.error('Player', 'Deezer autoplay fallback failed', { err: String(err) });
      }
    }

    resolver(null);
  });

  events.on('emptyChannel', (queue) => {
    clearNpMessage(queue);
    logger.info('Player', 'Voice channel empty, leaving per configured timeout', {
      guildId: queue.guild.id,
    });
  });

  // Stream-level error on a single track — log and let discord-player
  // auto-advance to the next track rather than killing the whole queue.
  events.on('playerError', (queue, error, track) => {
    const errMsg = error?.message || String(error);
    const errStack = error?.stack || '';
    logger.error('Player', 'Playback error on track, skipping', {
      guildId: queue.guild.id,
      track: track?.title,
      url: track?.url,
      extractor: track?.extractor?.identifier || 'unknown',
      errorType: error?.name || 'unknown',
      errorMessage: errMsg.slice(0, 500),
    });
    const channel = getTextChannel(queue);
    channel
      ?.send(`⚠️ Had trouble playing **${track?.title}**, skipping to the next track.`)
      .catch(() => null);
  });

  // A track that never produced a stream (e.g. every YouTube download method failed) is skipped
  // here without a playerError, so log it and tell the channel instead of failing silently.
  events.on('playerSkip', (queue, track, reason, description) => {
    if (queue.metadata) queue.metadata.skipped = true; // so playerFinish doesn't flag a quick manual skip
    if (reason !== 'ERR_NO_STREAM') return; // manual skips, jumps, seeks past the end
    logger.warn('Player', 'Track skipped', {
      guildId: queue.guild.id,
      track: track?.title,
      url: track?.url,
      reason,
      description: String(description ?? '').slice(0, 300),
    });
    getTextChannel(queue)
      ?.send(`⚠️ Couldn't stream **${track?.title}**, skipping it.`)
      .catch(() => null);
  });

  // A source can hand over a stream that ends at once with no audio (e.g. yt-dlp blocked by
  // YouTube's bot check). discord-player treats that as a normal finish, so flag it here.
  events.on('playerFinish', (queue, track) => {
    const { startedAt } = queue.metadata ?? {};
    if (!startedAt || Date.now() - startedAt > EMPTY_STREAM_MS) return;
    if (track?.durationMS && track.durationMS <= EMPTY_STREAM_MS) return; // genuinely tiny clip
    // skip() ends the stream (-> playerFinish) before it emits playerSkip; wait a tick for that flag
    setImmediate(() => {
      if (queue.metadata?.skipped || queue.deleted) return; // quick manual skip, /stop, End Session
      logger.warn('Player', 'Track ended immediately (empty stream)', {
        guildId: queue.guild.id,
        track: track?.title,
        url: track?.url,
        extractor: track?.extractor?.identifier,
      });
      getTextChannel(queue)
        ?.send(`⚠️ Couldn't stream **${track?.title || track?.url}**, it ended with no audio.`)
        .catch(() => null);
    });
  });

  // General queue-level error (extraction, connection, etc.)
  events.on('error', (queue, error) => {
    logger.error('Player', 'Queue-level error', { guildId: queue?.guild?.id, err: String(error) });
  });

  events.on('disconnect', (queue) => {
    clearNpMessage(queue);
    logger.warn('Player', 'Bot was disconnected from voice, queue cleared by discord-player', {
      guildId: queue.guild.id,
    });
  });

  events.on('connectionDestroyed', (queue) => {
    clearNpMessage(queue);
    logger.warn('Player', 'Voice connection destroyed', { guildId: queue.guild.id });
  });
}

module.exports = { registerPlayerEvents };
