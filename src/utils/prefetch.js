const crypto = require('node:crypto');
const { Readable, PassThrough } = require('node:stream');
const { QueueRepeatMode } = require('discord-player');
const logger = require('./logger');
const { pickAutoplayTrack } = require('./autoplay');

// Finding a stream for the next song takes several seconds (YouTube tries a few download methods),
// which used to be dead air between songs. Near the end of each song we look up the next song's
// stream ahead of time and hand it to discord-player through its onBeforeCreateStream hook.

// How close to the end of the current song the next one is looked up. Long enough to cover a slow
// lookup on a weak VPS (an early autoplay pick plus the stream lookup), short enough that the
// prepared stream isn't sitting idle for minutes.
const PREFETCH_BEFORE_END_MS = 60_000;
const CHECK_INTERVAL_MS = 3_000;
// A stream left waiting longer than this (e.g. playback paused) may have been dropped by YouTube
const MAX_AGE_MS = 150_000;
// Waiting longer than this at song change means the lookup didn't finish in time (worth logging)
const SLOW_WAIT_MS = 1_000;

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

// A YouTube (SABR) stream that's opened but not read for a minute can stall for 30s+ once playback
// starts reading it. Keep it downloading into memory while it waits (a song is a few MB of audio).
const BUFFER_BYTES = 64 * 1024 * 1024;

function keepFlowing(stream) {
  const readable = stream instanceof Readable ? stream : stream?.stream;
  if (!(readable instanceof Readable)) return stream;
  const buffer = new PassThrough({ highWaterMark: BUFFER_BYTES });
  readable.on('error', (err) => buffer.destroy(err));
  buffer.on('close', () => { if (!readable.destroyed) readable.destroy(); });
  readable.pipe(buffer);
  return readable === stream ? buffer : { ...stream, stream: buffer };
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

// Autoplay normally picks its next song only after the current one ends, which leaves a gap.
// Instead we pick it near the end and queue it, so it's prefetched like any queued song.
const autoplayPicks = new WeakSet(); // tracks queued by the early pick
const autoplayPickedFor = new Map(); // guildId -> id of the song the early pick ran for

// An early pick only stands in for an empty queue: drop it once someone queues their own songs
// or autoplay is turned off, so it doesn't play ahead of (or instead of) what people asked for
function dropStaleAutoplayPicks(queue) {
  const keep = queue.repeatMode === QueueRepeatMode.AUTOPLAY && queue.tracks.size === 1;
  if (keep) return;
  for (const track of queue.tracks.toArray()) {
    if (autoplayPicks.has(track)) queue.removeTrack(track);
  }
}

function pickAutoplayEarly(player, queue, current) {
  const guildId = queue.guild.id;
  if (autoplayPickedFor.get(guildId) === current.id) return;
  autoplayPickedFor.set(guildId, current.id);

  const lastTrack = { title: current.title, author: current.author, url: current.url };
  (async () => {
    const pick = await pickAutoplayTrack(queue, [], lastTrack);
    // Things may have changed during the search; if so the regular end-of-song autoplay takes over
    const unchanged = !queue.deleted && queue.currentTrack?.id === current.id && queue.tracks.size === 0
      && queue.repeatMode === QueueRepeatMode.AUTOPLAY;
    if (!pick || !unchanged) return;
    autoplayPicks.add(pick);
    queue.addTrack(pick);
    logger.info('Player', 'Autoplay queued the next song early', { title: pick.title });
  })().catch((err) => logger.warn('Prefetch', 'Early autoplay pick failed', { err: String(err?.message ?? err) }));
}

function check(player) {
  for (const guildId of prepared.keys()) {
    if (!player.nodes.cache.has(guildId)) discard(guildId);
  }

  for (const queue of player.nodes.cache.values()) {
    const guildId = queue.guild.id;
    dropStaleAutoplayPicks(queue);
    const next = nextTrack(queue);
    const entry = prepared.get(guildId);

    // The queue changed (skip, shuffle, remove, clear) since this was prepared, or it got too old
    if (entry && (entry.trackId !== next?.id || Date.now() - entry.createdAt > MAX_AGE_MS)) discard(guildId);
    if (prepared.has(guildId)) continue;

    const current = queue.currentTrack;
    if (!current || !queue.node.isPlaying()) continue;
    const remaining = (current.durationMS || 0) - queue.node.estimatedPlaybackTime;
    if (remaining > PREFETCH_BEFORE_END_MS) continue;

    if (!next) {
      if (queue.repeatMode === QueueRepeatMode.AUTOPLAY) pickAutoplayEarly(player, queue, current);
      continue;
    }

    const startedAt = Date.now();
    const promise = extractStream(player, next)
      .then((stream) => {
        if (!stream) return null;
        logger.info('Prefetch', `Prepared "${next.title}" in ${Date.now() - startedAt} ms`);
        return keepFlowing(stream);
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

  const waitStart = Date.now();
  const stream = await entry.promise;
  const waited = Date.now() - waitStart;
  if (waited > SLOW_WAIT_MS) {
    logger.warn('Prefetch', `"${track.title}" wasn't ready in time, waited ${waited} ms (lookup took ${Date.now() - entry.createdAt} ms)`);
  }
  if (!stream) {
    logger.warn('Prefetch', `No prepared stream for "${track.title}", looking it up now`);
    return null;
  }
  if (!isUsable(stream)) {
    logger.warn('Prefetch', `Prepared stream for "${track.title}" was closed, looking it up again`);
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

  player.events.on('queueDelete', (queue) => {
    discard(queue.guild.id);
    autoplayPickedFor.delete(queue.guild.id);
  });
}

module.exports = { startPrefetcher, onBeforeCreateStream, discard };
