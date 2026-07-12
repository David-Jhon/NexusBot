const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');

// Ensure the data directory exists before opening the file
fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

const db = new Database(config.databaseFile);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guildId          TEXT PRIMARY KEY,
    twentyFourSeven  INTEGER NOT NULL DEFAULT 0,
    autoplay         INTEGER NOT NULL DEFAULT 0,
    defaultVolume    INTEGER NOT NULL DEFAULT 80,
    voteSkipThreshold REAL NOT NULL DEFAULT 0.5
  );

  CREATE TABLE IF NOT EXISTS queue_snapshots (
    guildId        TEXT PRIMARY KEY,
    voiceChannelId TEXT NOT NULL,
    textChannelId  TEXT,
    tracksJson     TEXT NOT NULL,
    currentIndex   INTEGER NOT NULL DEFAULT 0,
    repeatMode     INTEGER NOT NULL DEFAULT 0,
    volume         INTEGER NOT NULL DEFAULT 80,
    updatedAt      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saved_playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId    TEXT NOT NULL,
    ownerId    TEXT NOT NULL,
    name       TEXT NOT NULL,
    tracksJson TEXT NOT NULL,
    createdAt  TEXT NOT NULL,
    UNIQUE(guildId, ownerId, name)
  );
`);

// ---------- Guild settings ----------

const getGuildSettingsStmt = db.prepare(`SELECT * FROM guild_settings WHERE guildId = ?`);
const insertGuildSettingsStmt = db.prepare(`
  INSERT INTO guild_settings (guildId, twentyFourSeven, autoplay, defaultVolume, voteSkipThreshold)
  VALUES (@guildId, @twentyFourSeven, @autoplay, @defaultVolume, @voteSkipThreshold)
`);

function getGuildSettings(guildId) {
  let row = getGuildSettingsStmt.get(guildId);
  if (!row) {
    const defaults = {
      guildId,
      twentyFourSeven: 0,
      autoplay: 0,
      defaultVolume: config.defaultVolume,
      voteSkipThreshold: 0.5,
    };
    insertGuildSettingsStmt.run(defaults);
    row = defaults;
  }
  return {
    guildId: row.guildId,
    twentyFourSeven: Boolean(row.twentyFourSeven),
    autoplay: Boolean(row.autoplay),
    defaultVolume: row.defaultVolume,
    voteSkipThreshold: row.voteSkipThreshold,
  };
}

function updateGuildSettings(guildId, patch) {
  const current = getGuildSettings(guildId);
  const next = { ...current, ...patch };
  db.prepare(`
    UPDATE guild_settings
    SET twentyFourSeven = @twentyFourSeven,
        autoplay = @autoplay,
        defaultVolume = @defaultVolume,
        voteSkipThreshold = @voteSkipThreshold
    WHERE guildId = @guildId
  `).run({
    guildId,
    twentyFourSeven: next.twentyFourSeven ? 1 : 0,
    autoplay: next.autoplay ? 1 : 0,
    defaultVolume: next.defaultVolume,
    voteSkipThreshold: next.voteSkipThreshold,
  });
  return next;
}

// ---------- Queue snapshots (persistence + reconnect recovery) ----------

const upsertSnapshotStmt = db.prepare(`
  INSERT INTO queue_snapshots (guildId, voiceChannelId, textChannelId, tracksJson, currentIndex, repeatMode, volume, updatedAt)
  VALUES (@guildId, @voiceChannelId, @textChannelId, @tracksJson, @currentIndex, @repeatMode, @volume, @updatedAt)
  ON CONFLICT(guildId) DO UPDATE SET
    voiceChannelId = excluded.voiceChannelId,
    textChannelId = excluded.textChannelId,
    tracksJson = excluded.tracksJson,
    currentIndex = excluded.currentIndex,
    repeatMode = excluded.repeatMode,
    volume = excluded.volume,
    updatedAt = excluded.updatedAt
`);

function saveQueueSnapshot(guildId, snapshot) {
  upsertSnapshotStmt.run({
    guildId,
    voiceChannelId: snapshot.voiceChannelId,
    textChannelId: snapshot.textChannelId || null,
    tracksJson: JSON.stringify(snapshot.tracks || []),
    currentIndex: snapshot.currentIndex || 0,
    repeatMode: snapshot.repeatMode || 0,
    volume: snapshot.volume || config.defaultVolume,
    updatedAt: new Date().toISOString(),
  });
}

function getQueueSnapshot(guildId) {
  const row = db.prepare(`SELECT * FROM queue_snapshots WHERE guildId = ?`).get(guildId);
  if (!row) return null;
  return {
    ...row,
    tracks: JSON.parse(row.tracksJson),
  };
}

function deleteQueueSnapshot(guildId) {
  db.prepare(`DELETE FROM queue_snapshots WHERE guildId = ?`).run(guildId);
}

function getAllQueueSnapshots() {
  return db.prepare(`SELECT * FROM queue_snapshots`).all().map((row) => ({
    ...row,
    tracks: JSON.parse(row.tracksJson),
  }));
}

// ---------- Saved playlists ----------

function savePlaylist(guildId, ownerId, name, tracks) {
  db.prepare(`
    INSERT INTO saved_playlists (guildId, ownerId, name, tracksJson, createdAt)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guildId, ownerId, name) DO UPDATE SET
      tracksJson = excluded.tracksJson,
      createdAt = excluded.createdAt
  `).run(guildId, ownerId, name, JSON.stringify(tracks), new Date().toISOString());
}

function loadPlaylist(guildId, ownerId, name) {
  const row = db.prepare(`
    SELECT * FROM saved_playlists WHERE guildId = ? AND ownerId = ? AND name = ?
  `).get(guildId, ownerId, name);
  if (!row) return null;
  return { ...row, tracks: JSON.parse(row.tracksJson) };
}

function listPlaylists(guildId, ownerId) {
  return db.prepare(`
    SELECT name, createdAt FROM saved_playlists WHERE guildId = ? AND ownerId = ? ORDER BY createdAt DESC
  `).all(guildId, ownerId);
}

function deletePlaylist(guildId, ownerId, name) {
  const info = db.prepare(`
    DELETE FROM saved_playlists WHERE guildId = ? AND ownerId = ? AND name = ?
  `).run(guildId, ownerId, name);
  return info.changes > 0;
}

module.exports = {
  db,
  getGuildSettings,
  updateGuildSettings,
  saveQueueSnapshot,
  getQueueSnapshot,
  deleteQueueSnapshot,
  getAllQueueSnapshots,
  savePlaylist,
  loadPlaylist,
  listPlaylists,
  deletePlaylist,
};
