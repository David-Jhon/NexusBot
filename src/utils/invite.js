const { OAuth2Scopes, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const config = require('../config');

// Everything the bot needs to post now-playing panels and stream audio
const REQUIRED_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.UseVAD,
  PermissionFlagsBits.RequestToSpeak,
]);

function getInviteUrl(clientId = config.clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: REQUIRED_PERMISSIONS.bitfield.toString(),
    scope: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

module.exports = { REQUIRED_PERMISSIONS, getInviteUrl };
