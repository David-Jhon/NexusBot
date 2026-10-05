const { QueueRepeatMode } = require('discord-player');
const db = require('../database/db');

const YOUTUBE_ENGINE = 'ext:com.retrouser955.discord-player.discord-player-youtubei';
const DEEZER_ENGINE = 'ext:com.retrouser955.discord-player.deezr-ext';

/**
 * Force the right extractor for YouTube/Deezer links. Without this the Deezer and
 * attachment extractors can claim YouTube URLs. Track objects and text searches pass through.
 */
function searchEngineFor(query) {
  if (typeof query !== 'string') return undefined;
  if (/(?:youtube\.com|youtu\.be)/i.test(query)) return YOUTUBE_ENGINE;
  if (/deezer\.com|dzr\.page\.link/i.test(query)) return DEEZER_ENGINE;
  return undefined;
}

/**
 * Options for player.play(). nodeOptions only take effect when this call creates the queue,
 * so every entry point (play, search, playnext, playlist, restore) must pass the guild settings.
 */
function buildPlayOptions(guildId, { query, requestedBy = null, textChannelId = null, volume } = {}) {
  const settings = db.getGuildSettings(guildId);
  const options = {
    requestedBy,
    nodeOptions: {
      metadata: { textChannelId },
      volume: volume ?? settings.defaultVolume,
      leaveOnEmpty: !settings.twentyFourSeven,
      leaveOnEmptyCooldown: 60_000,
      leaveOnEnd: !settings.twentyFourSeven,
      leaveOnEndCooldown: 60_000,
      leaveOnStop: !settings.twentyFourSeven,
      selfDeaf: true,
    },
  };
  const engine = searchEngineFor(query);
  if (engine) options.searchEngine = engine;
  return options;
}

/** Turn on autoplay for a queue if the guild wants it, without overriding a loop mode the user picked. */
function applyGuildAutoplay(queue) {
  if (db.getGuildSettings(queue.guild.id).autoplay && queue.repeatMode === QueueRepeatMode.OFF) {
    queue.setRepeatMode(QueueRepeatMode.AUTOPLAY);
  }
}

module.exports = { YOUTUBE_ENGINE, DEEZER_ENGINE, searchEngineFor, buildPlayOptions, applyGuildAutoplay };
