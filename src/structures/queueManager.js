const { useMainPlayer, useQueue, QueueRepeatMode } = require('discord-player');
const db = require('../database/db');
const logger = require('../utils/logger');
const config = require('../config');

// Debounce map so we don't hammer SQLite on every single queue mutation event
const pendingSnapshotTimers = new Map();

/**
 * Serialize the current state of a guild's queue to the database.
 * Called (debounced) on track add/remove/start/skip so a crash/restart
 * can rehydrate close to where it left off.
 */
function scheduleSnapshot(guildId) {
  if (pendingSnapshotTimers.has(guildId)) return;

  const timer = setTimeout(() => {
    pendingSnapshotTimers.delete(guildId);
    try {
      const queue = useQueue(guildId);
      if (!queue || !queue.channel) {
        db.deleteQueueSnapshot(guildId);
        return;
      }

      const tracks = [];
      if (queue.currentTrack) tracks.push(serializeTrack(queue.currentTrack));
      for (const t of queue.tracks.toArray()) tracks.push(serializeTrack(t));

      if (tracks.length === 0) {
        db.deleteQueueSnapshot(guildId);
        return;
      }

      db.saveQueueSnapshot(guildId, {
        voiceChannelId: queue.channel.id,
        textChannelId: queue.metadata?.textChannelId || null,
        tracks,
        currentIndex: 0, // currentTrack is always stored at index 0
        repeatMode: queue.repeatMode,
        volume: queue.node.volume,
      });
    } catch (err) {
      logger.error('QueueManager', 'Failed to write snapshot', { guildId, err: String(err) });
    }
  }, config.snapshotDebounceMs);

  pendingSnapshotTimers.set(guildId, timer);
}

function serializeTrack(track) {
  return {
    url: track.url,
    title: track.title,
    requestedById: track.requestedBy?.id || null,
  };
}

function clearSnapshot(guildId) {
  db.deleteQueueSnapshot(guildId);
}

/**
 * Called once on bot startup. For every guild that has a saved snapshot,
 * rejoin the stored voice channel and re-enqueue the stored tracks.
 * This is the "reconnect recovery" path for full-process restarts
 * (crash, deploy, OOM) as opposed to in-session voice hiccups, which are
 * handled by the player event listeners + watchdog instead.
 */
async function rehydrateAllQueues(client) {
  const player = useMainPlayer();
  const snapshots = db.getAllQueueSnapshots();

  for (const snapshot of snapshots) {
    try {
      const guild = await client.guilds.fetch(snapshot.guildId).catch(() => null);
      if (!guild) {
        db.deleteQueueSnapshot(snapshot.guildId);
        continue;
      }

      const channel = await guild.channels.fetch(snapshot.voiceChannelId).catch(() => null);
      if (!channel || !channel.isVoiceBased()) {
        db.deleteQueueSnapshot(snapshot.guildId);
        continue;
      }

      if (!snapshot.tracks.length) continue;

      const [first, ...rest] = snapshot.tracks;

      const { queue } = await player.play(channel, first.url, {
        nodeOptions: {
          metadata: { textChannelId: snapshot.textChannelId },
          volume: snapshot.volume,
          leaveOnEmpty: false,
          leaveOnEnd: false,
          leaveOnStop: false,
        },
      });

      queue.setRepeatMode(snapshot.repeatMode ?? QueueRepeatMode.OFF);

      for (const t of rest) {
        await player.play(channel, t.url, {
          nodeOptions: { metadata: { textChannelId: snapshot.textChannelId } },
        }).catch((err) =>
          logger.warn('QueueManager', 'Skipped a track during rehydration', {
            guildId: snapshot.guildId,
            url: t.url,
            err: String(err),
          }),
        );
      }

      logger.info('QueueManager', 'Rehydrated queue after restart', {
        guildId: snapshot.guildId,
        tracks: snapshot.tracks.length,
      });
    } catch (err) {
      logger.error('QueueManager', 'Failed to rehydrate queue', {
        guildId: snapshot.guildId,
        err: String(err),
      });
      db.deleteQueueSnapshot(snapshot.guildId);
    }
  }
}

/**
 * Watchdog: periodically checks that every guild we believe is "active"
 * (24/7 enabled, or has a live queue) still has a healthy voice connection.
 * Catches silent connection deaths that don't cleanly emit a disconnect event.
 */
function startWatchdog(client) {
  setInterval(() => {
    const player = useMainPlayer();
    for (const queue of player.nodes.cache.values()) {
      const status = queue.connection?.state?.status;
      const unhealthy = !queue.connection || status === 'destroyed' || status === 'disconnected';

      if (unhealthy && queue.channel) {
        logger.warn('Watchdog', 'Detected unhealthy voice connection, attempting rejoin', {
          guildId: queue.guild.id,
          status,
        });
        queue.connection?.rejoin?.();
      }
    }
  }, config.watchdogIntervalMs);
}

module.exports = {
  scheduleSnapshot,
  clearSnapshot,
  rehydrateAllQueues,
  startWatchdog,
};
