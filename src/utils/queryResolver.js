const { useMainPlayer, QueryResolver } = require('discord-player');

/**
 * Detect query type and find the best extractor.
 * Returns { isUrl, extractor, canStream, type, error }
 */
async function resolveQuery(query) {
  const player = useMainPlayer();
  const result = {
    isUrl: false,
    extractor: null,
    canStream: false,
    type: 'search',
    error: null,
  };

  // 1. Is it a URL?
  try {
    new URL(query);
    result.isUrl = true;
  } catch {
    return result;
  }

  // 2. Find matching extractor (highest priority first)
  const extractors = [...player.extractors.store.values()]
    .sort((a, b) => b.priority - a.priority);

  for (const extractor of extractors) {
    try {
      const resolvedType = QueryResolver.resolve(query).type;
      if (await extractor.validate(query, resolvedType)) {
        result.extractor = extractor;
        break;
      }
    } catch {
      // Extractor threw — skip it
    }
  }

  // 3. No extractor found
  if (!result.extractor) {
    result.error = 'No extractor found for that URL. It may be an unsupported source.';
    return result;
  }

  // 4. Determine if extractor can stream directly (no bridge needed)
  const streamingExtractors = [
    'com.discord-player.youtubeiextractor',
    'com.discord-player.soundcloudextractor',
    'com.discord-player.deezerextractor',
    'com.discord-player.tts',
    'com.discord-player.attachmentextractor',
  ];
  result.canStream = streamingExtractors.includes(result.extractor.identifier);

  // 5. Detect playlist vs track from URL
  if (/playlist|album|mix|compilation|set|list/i.test(query)) {
    result.type = 'playlist';
  } else {
    result.type = 'track';
  }

  return result;
}

module.exports = { resolveQuery };
