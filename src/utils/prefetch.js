const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { QueueRepeatMode } = require('discord-player');
const logger = require('./logger');

// Finding a stream for the next song takes several seconds (YouTube tries a few download methods),
// which used to be dead air between songs. Near the end of each song we look up the next song's
// stream ahead of time and hand it to discord-player through its onBeforeCreateStream hook.

// How close to the end of the current song the next one is looked up. Long enough to cover a slow
// lookup, short enough that the prepared stream isn't sitting idle for minutes.
const PREFETCH_BEFORE_END_MS = 30_000;
const CHECK_INTERVAL_MS = 3_000;
// A stream left waiting longer than this (e.g. playback paused) may have been dropped by YouTube
const MAX_AGE_MS = 120_000;

// guildId -> { trackId, promise (resolves to the stream or null), createdAt }
const prepared = new Map();

function discard(guildId) {
  const entry = prepared.get(guildId);
  if (!entry) return;
  prepared.delete(guildId);
  entry.promise.then((stream) => destroyStream(stream)).catch(() => null);
}

function destroyStream(stream) {
  const readable = stream instanceof Readable ? stream : stream?.stream;
  if (readable instanceof Readable && !readable.destroyed) readable.destroy();
}

function isUsable(stream) {
  if (typeof stream === 'string') return true;
  const readable = stream instanceof Readable ? stream : stream?.stream;
  return readable instanceof Readable && !readable.destroyed && !readable.errored && !readable.readableEnded;
}

// Same lookup discord-player does when a song starts (minus its title-search fallback, which still
// runs at play time if this finds nothing)
async function extractStream(player, track) {
  const context = { id: crypto.randomUUID(), attemptedExtractors: new Set(), bridgeAttemptedExtractors: new Set() };
  const info = await player.extractors.context.provide(context, () => player.extractors.run(async (extractor) => {
    if (player.options.blockStreamFrom?.includes(extractor.identifier)) return false;
    const canStream = await extractor.validate(track.url, track.queryType || track.source);
    if (!canStream) return false;
    return extractor.stream(track);
  }, false));
  return info?.result || null;
}

function nextTrack(queue) {
  // Repeat-track replays the current song, and a queue loop's next song is only known once it wraps
  if (queue.repeatMode === QueueRepeatMode.TRACK) return null;
  return queue.tracks.at(0) || null;
}

function check(player) {
  for (const guildId of prepared.keys()) {
    if (!player.nodes.cache.has(guildId)) discard(guildId);
  }

  for (const queue of player.nodes.cache.values()) {
    const guildId = queue.guild.id;
    const next = nextTrack(queue);
    const entry = prepared.get(guildId);

    // The queue changed (skip, shuffle, remove, clear) since this was prepared, or it got too old
    if (entry && (entry.trackId !== next?.id || Date.now() - entry.createdAt > MAX_AGE_MS)) discard(guildId);
    if (!next || prepared.has(guildId)) continue;

    const current = queue.currentTrack;
    if (!current || !queue.node.isPlaying()) continue;
    const remaining = (current.durationMS || 0) - queue.node.estimatedPlaybackTime;
    if (remaining > PREFETCH_BEFORE_END_MS) continue;

    const startedAt = Date.now();
    const promise = extractStream(player, next)
      .then((stream) => {
        if (stream && process.env.PLAYER_DEBUG === '1') {
          logger.info('Prefetch', `Prepared "${next.title}" in ${Date.now() - startedAt} ms`);
        }
        return stream;
      })
      .catch((err) => {
        logger.warn('Prefetch', `Could not prepare "${next.title}"`, { err: String(err?.message ?? err).slice(0, 300) });
        return null;
      });
    prepared.set(guildId, { trackId: next.id, promise, createdAt: startedAt });
  }
}

// discord-player calls this before looking up a song's stream; returning null lets it do the lookup itself
async function onBeforeCreateStream(track, _queryType, queue) {
  const guildId = queue.guild.id;
  const entry = prepared.get(guildId);
  if (!entry || entry.trackId !== track.id) return null;
  prepared.delete(guildId);

  const stream = await entry.promise;
  if (!stream) return null;
  if (!isUsable(stream)) {
    destroyStream(stream);
    return null;
  }
  return stream;
}

function startPrefetcher(player) {
  const timer = setInterval(() => {
    try {
      check(player);
    } catch (err) {
      logger.warn('Prefetch', 'Check failed', { err: String(err) });
    }
  }, CHECK_INTERVAL_MS);
  timer.unref();

  player.events.on('queueDelete', (queue) => discard(queue.guild.id));
}

module.exports = { startPrefetcher, onBeforeCreateStream, discard };
