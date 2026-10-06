const { nowPlayingEmbed } = require('../../utils/embeds');
const { nowPlayingButtons } = require('../../utils/buttons');
const { clearNpMessage, registerNpMessage, startNpAutoRefresh } = require('../../utils/nowPlayingManager');
const queueManager = require('../../structures/queueManager');
const logger = require('../../utils/logger');
const { pickAutoplayTrack } = require('../../utils/autoplay');

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

  events.on('queueDelete', (queue) => queueManager.onQueueDeleted(queue.guild.id));

  events.on('emptyQueue', (queue) => {
    clearNpMessage(queue);
    queueManager.clearSnapshot(queue.guild.id);
  });

  // AUTOPLAY: YouTube Music radio, then related tracks, then a search by artist (utils/autoplay.js)
  events.on('willAutoPlay', async (queue, tracks, resolver) => {
    logger.info('Player', 'Autoplay triggered', {
      guildId: queue.guild.id,
      relatedTracks: tracks.length,
    });

    // Usually the next song was already picked and queued before this one ended (see utils/prefetch.js);
    // this runs when that early pick found nothing or the song ended too soon for it
    const pick = await pickAutoplayTrack(queue, tracks, queue.metadata?.lastTrack).catch((err) => {
      logger.error('Player', 'Autoplay pick failed', { err: String(err) });
      return null;
    });
    resolver(pick);
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
