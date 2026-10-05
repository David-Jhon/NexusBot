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

  CREATE TABLE IF NOT EXISTS reaction_role_panels (
    messageId   TEXT PRIMARY KEY,
    guildId     TEXT NOT NULL,
    channelId   TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    style       TEXT NOT NULL DEFAULT 'reaction',
    mode        TEXT NOT NULL DEFAULT 'normal',
    maxRoles    INTEGER NOT NULL DEFAULT 0,
    createdBy   TEXT NOT NULL,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reaction_roles (
    messageId TEXT NOT NULL,
    roleId    TEXT NOT NULL,
    emojiKey  TEXT,
    emojiRaw  TEXT,
    label     TEXT,
    position  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (messageId, roleId)
  );

  CREATE INDEX IF NOT EXISTS idx_reaction_role_panels_guild ON reaction_role_panels (guildId);
  CREATE INDEX IF NOT EXISTS idx_reaction_roles_role ON reaction_roles (roleId);
`);

// Columns added after release: add them to databases created by older versions
if (!db.prepare(`PRAGMA table_info(reaction_roles)`).all().some((c) => c.name === 'description')) {
  db.exec(`ALTER TABLE reaction_roles ADD COLUMN description TEXT`);
}

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

// ---------- Reaction roles ----------

// getPanel/deletePanel run on every reaction and every message delete, so prepare once
const rrStmts = {
  insertPanel: db.prepare(`
    INSERT INTO reaction_role_panels (messageId, guildId, channelId, title, description, style, mode, maxRoles, createdBy, createdAt)
    VALUES (@messageId, @guildId, @channelId, @title, @description, @style, @mode, @maxRoles, @createdBy, @createdAt)
  `),
  getPanel: db.prepare(`SELECT * FROM reaction_role_panels WHERE messageId = ?`),
  listPanels: db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM reaction_roles r WHERE r.messageId = p.messageId) AS roleCount
    FROM reaction_role_panels p WHERE p.guildId = ? ORDER BY p.createdAt DESC
  `),
  updatePanel: db.prepare(`
    UPDATE reaction_role_panels SET mode = @mode, maxRoles = @maxRoles WHERE messageId = @messageId
  `),
  deleteMappings: db.prepare(`DELETE FROM reaction_roles WHERE messageId = ?`),
  deletePanel: db.prepare(`DELETE FROM reaction_role_panels WHERE messageId = ?`),
  nextPosition: db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM reaction_roles WHERE messageId = ?`),
  insertMapping: db.prepare(`
    INSERT INTO reaction_roles (messageId, roleId, emojiKey, emojiRaw, label, description, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  deleteMapping: db.prepare(`DELETE FROM reaction_roles WHERE messageId = ? AND roleId = ?`),
  getMappings: db.prepare(`SELECT * FROM reaction_roles WHERE messageId = ? ORDER BY position`),
  mappingsByRole: db.prepare(`SELECT * FROM reaction_roles WHERE roleId = ?`),
  deleteByRole: db.prepare(`DELETE FROM reaction_roles WHERE roleId = ?`),
};

function createPanel(panel) {
  rrStmts.insertPanel.run({
    description: null,
    maxRoles: 0,
    ...panel,
    createdAt: new Date().toISOString(),
  });
}

function getPanel(messageId) {
  return rrStmts.getPanel.get(messageId) || null;
}

function listPanels(guildId) {
  return rrStmts.listPanels.all(guildId);
}

function updatePanel(messageId, patch) {
  const current = getPanel(messageId);
  if (!current) return null;
  const next = { ...current, ...patch };
  rrStmts.updatePanel.run({ messageId, mode: next.mode, maxRoles: next.maxRoles });
  return next;
}

const deletePanelTx = db.transaction((messageId) => {
  rrStmts.deleteMappings.run(messageId);
  return rrStmts.deletePanel.run(messageId).changes > 0;
});

function deletePanel(messageId) {
  return deletePanelTx(messageId);
}

function addReactionRole(messageId, { roleId, emojiKey = null, emojiRaw = null, label = null, description = null }) {
  const { next } = rrStmts.nextPosition.get(messageId);
  rrStmts.insertMapping.run(messageId, roleId, emojiKey, emojiRaw, label, description, next);
}

function removeReactionRole(messageId, roleId) {
  return rrStmts.deleteMapping.run(messageId, roleId).changes > 0;
}

function getReactionRoles(messageId) {
  return rrStmts.getMappings.all(messageId);
}

/** Removes a deleted role from every panel; returns the removed mappings (messageId, emojiKey, ...). */
const removeRoleEverywhere = db.transaction((roleId) => {
  const removed = rrStmts.mappingsByRole.all(roleId);
  rrStmts.deleteByRole.run(roleId);
  return removed;
});

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
  createPanel,
  getPanel,
  listPanels,
  updatePanel,
  deletePanel,
  addReactionRole,
  removeReactionRole,
  getReactionRoles,
  removeRoleEverywhere,
};
