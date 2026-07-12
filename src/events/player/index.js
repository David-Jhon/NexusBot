const { nowPlayingEmbed } = require('../../utils/embeds');
const { nowPlayingButtons } = require('../../utils/buttons');
const queueManager = require('../../structures/queueManager');
const logger = require('../../utils/logger');

/**
 * Resolve the text channel to post updates in, using the metadata we
 * attach at play-time (see commands/play.js).
 */
function getTextChannel(queue) {
  const id = queue.metadata?.textChannelId;
  if (!id) return null;
  return queue.channel?.guild?.channels?.cache?.get(id) || null;
}

function registerPlayerEvents(player) {
  const events = player.events;

  events.on('playerStart', (queue, track) => {
    const channel = getTextChannel(queue);
    if (channel) {
      channel
        .send({ embeds: [nowPlayingEmbed(track, queue)], components: [nowPlayingButtons(queue)] })
        .catch(() => null);
    }
    queueManager.scheduleSnapshot(queue.guild.id);
  });

  events.on('audioTrackAdd', (queue) => queueManager.scheduleSnapshot(queue.guild.id));
  events.on('audioTracksAdd', (queue) => queueManager.scheduleSnapshot(queue.guild.id));
  events.on('audioTrackRemove', (queue) => queueManager.scheduleSnapshot(queue.guild.id));

  events.on('emptyQueue', (queue) => {
    // Autoplay handles "never truly empty" — this only fires if autoplay is off.
    queueManager.clearSnapshot(queue.guild.id);
  });

  events.on('emptyChannel', (queue) => {
    logger.info('Player', 'Voice channel empty, leaving per configured timeout', {
      guildId: queue.guild.id,
    });
  });

  // Stream-level error on a single track — log and let discord-player
  // auto-advance to the next track rather than killing the whole queue.
  events.on('playerError', (queue, error, track) => {
    logger.error('Player', 'Playback error on track, skipping', {
      guildId: queue.guild.id,
      track: track?.title,
      err: String(error),
    });
    const channel = getTextChannel(queue);
    channel
      ?.send(`⚠️ Had trouble playing **${track?.title}**, skipping to the next track.`)
      .catch(() => null);
  });

  // General queue-level error (extraction, connection, etc.)
  events.on('error', (queue, error) => {
    logger.error('Player', 'Queue-level error', { guildId: queue?.guild?.id, err: String(error) });
  });

  events.on('disconnect', (queue) => {
    logger.warn('Player', 'Bot was disconnected from voice, queue cleared by discord-player', {
      guildId: queue.guild.id,
    });
  });

  events.on('connectionDestroyed', (queue) => {
    logger.warn('Player', 'Voice connection destroyed', { guildId: queue.guild.id });
  });
}

module.exports = { registerPlayerEvents };
