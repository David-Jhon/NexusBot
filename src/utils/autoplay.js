const { useMainPlayer, Track, Util, QueryType } = require('discord-player');
const { YoutubeExtractor, getInnertube } = require('discord-player-youtubei');
const logger = require('./logger');

// Subtitle/reaction filter pattern — catches re-uploads, covers, remixes
const subtitlePattern = /\b(sub|subtitled?|dubbed?|dub|instrumental|karaoke|cover|remix|live|acoustic|piano|slowed|reverb|nightcore|sped\s*up|lyrics?\s*(video|version)?|official\s*(video|audio)?|music\s*video|reaction(\s*(video|compilation))?|the\s*first\s*take|live\s*session|concert|performance|unplugged|from\s*\w|feat\.?|ft\.?|featuring|compilation|greatest\s*hits|best\s*of|collection|bgm|background\s*music|top\s*\d+|music\s*mix|mega\s*mix|megamix|medley|playlist|mixtape|НА\s*РУССКОМ|EN\s*ESPAÑOL|EM\s*PORTUGUÊS|auf\s*deutsch|en\s*français|italiano|한국어|中文|日本語|العربية|हिन्दी|русский)\s*(v\d+)?|[\(\[][^\)\]]*(cover|remix|live|acoustic|piano|slowed|reverb|nightcore|sped|sub|dub|instrumental|karaoke|reaction|the\s*first\s*take|unplugged)[^\)\]]*[\)\]]/i;

// Fallback chain when the extractor has no related tracks, each forced to its own extractor
// (YouTube first so Deezer doesn't try to bridge)
const FALLBACK_ENGINES = [
  ['YouTube', 'ext:com.retrouser955.discord-player.discord-player-youtubei'],
  ['Spotify', 'ext:com.discord-player.itsmaat.spotifyextractor'],
  ['Deezer', 'ext:com.retrouser955.discord-player.deezr-ext'],
];

const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;

/**
 * YouTube Music's radio for a song: ~50 related songs by similar artists, like YouTube Music's own
 * autoplay. Songs from Spotify/Deezer are first matched on YouTube Music by title and artist.
 * (discord-player-youtubei's own related-tracks lookup no longer finds anything since YouTube
 * changed its page layout.)
 */
async function youtubeRadio(player, lastTrack) {
  const ext = player.extractors.get(YoutubeExtractor.identifier);
  if (!ext || !lastTrack) return [];
  const tube = await getInnertube();

  let videoId = lastTrack.url?.match(YOUTUBE_ID_RE)?.[1];
  if (!videoId) {
    const query = [lastTrack.title, lastTrack.author].filter(Boolean).join(' ').trim();
    if (!query) return [];
    const found = await tube.music.search(query, { type: 'song' });
    videoId = found.songs?.contents?.[0]?.id;
  }
  if (!videoId) return [];

  const panel = await tube.music.getUpNext(videoId, true);
  return (panel.contents || [])
    .filter((v) => v.video_id && v.video_id !== videoId && v.duration?.seconds)
    .map((v) => {
      const track = new Track(player, {
        title: v.title?.toString() || 'Unknown title',
        url: `https://www.youtube.com/watch?v=${v.video_id}`,
        duration: Util.buildTimeCode(Util.parseMS(v.duration.seconds * 1000)),
        thumbnail: v.thumbnail?.at(-1)?.url,
        author: v.artists?.map((a) => a.name).join(', ') || v.author || 'Unknown artist',
        requestedBy: null,
        source: 'youtube',
        queryType: QueryType.YOUTUBE_VIDEO,
      });
      track.extractor = ext;
      return track;
    });
}

/**
 * Choose the song autoplay plays after `lastTrack` ({ title, author, url }).
 * Tries YouTube Music's radio, then the extractor's related tracks, then a search by artist.
 */
async function pickAutoplayTrack(queue, relatedTracks, lastTrack) {
  const player = useMainPlayer();
  const played = [lastTrack, ...(queue.history?.tracks?.toArray?.() || [])].filter(Boolean);
  const playedUrls = new Set(played.map((t) => t.url));
  // The same song can come from Spotify and YouTube under different links, so compare titles too
  const songKey = (t) => (t.title || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const playedKeys = new Set(played.map(songKey).filter(Boolean));
  const unplayed = (tracks) => tracks.filter((t) => !playedUrls.has(t.url) && !playedKeys.has(songKey(t)));

  try {
    const radio = unplayed(await youtubeRadio(player, lastTrack));
    if (radio.length > 0) {
      // The radio lists the song's length, but its link is often the music video, which runs longer or
      // shorter. Look the video up so the duration (progress bar, prefetch timing) is right.
      const resolved = await player.search(radio[0].url, { searchEngine: FALLBACK_ENGINES[0][1] })
        .then((res) => res.tracks[0])
        .catch(() => null);
      const pick = resolved || radio[0];
      logger.info('Player', 'Autoplay: picked from YouTube Music radio', { title: pick.title, author: radio[0].author });
      return pick;
    }
  } catch (err) {
    logger.warn('Player', 'YouTube Music radio failed', { err: String(err?.message ?? err).slice(0, 300) });
  }

  const related = unplayed(relatedTracks);
  if (related.length > 0) return related[0];

  // Search by artist + "music" for variety (avoids generic single-word results).
  // A track YouTube served without metadata (blocked IP) has neither, so there's nothing to search for.
  const artist = lastTrack?.author?.trim();
  const query = artist ? `${artist} music` : lastTrack?.title?.trim();
  if (!query) return null;

  logger.info('Player', 'Autoplay fallback: searching', { query });

  // Check if title is too similar to the last played track
  const isSimilarTitle = (t) => {
    const clean = (s) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const a = clean(t.title);
    const b = clean(lastTrack.title);
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
    return intersection / Math.max(wordsA.size, wordsB.size) > 0.6;
  };

  // Check if track is actually by the same artist
  const isBySameArtist = (t) => {
    if (!artist) return true; // No artist info, accept any track
    const titleLower = t.title.toLowerCase();
    const authorLower = (t.author || '').toLowerCase();
    const artistLower = artist.toLowerCase();
    return titleLower.includes(artistLower) || authorLower.includes(artistLower);
  };

  const isUnique = (t) => !playedUrls.has(t.url) && !subtitlePattern.test(t.title) && !isSimilarTitle(t) && isBySameArtist(t);

  for (const [name, searchEngine] of FALLBACK_ENGINES) {
    try {
      const results = await player.search(query, { searchEngine });
      const unique = results?.tracks?.filter(isUnique) ?? [];
      if (unique.length > 0) {
        logger.info('Player', `Autoplay fallback: picked ${name} track`, { title: unique[0].title });
        return unique[0];
      }
    } catch (err) {
      logger.error('Player', `${name} autoplay fallback failed`, { err: String(err) });
    }
  }
  return null;
}

module.exports = { pickAutoplayTrack };
