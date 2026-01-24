import {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { lavalink } from "../lavalink";

export const data = new SlashCommandBuilder()
  .setName("play")
  .setDescription("Play a track (YouTube/SoundCloud/etc) in your voice channel")
  .addStringOption((opt) =>
    opt.setName("url").setDescription("A URL or search query").setRequired(true)
  );

// --------- helpers ---------

function isHttpUrl(s: string) {
  return s.startsWith("http://") || s.startsWith("https://");
}

function extractYouTubeId(input: string): string | null {
  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = u.pathname.replace("/", "").trim();
      return id || null;
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      const v = u.searchParams.get("v");
      return v || null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Normalizes YouTube URLs to a canonical watch URL (and strips mix/radio params).
 * If it's not a YouTube URL, returns the input unchanged.
 */
function normalizeYouTubeUrl(input: string) {
  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, "");

    const isYouTube =
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtu.be";

    if (!isYouTube) return input;

    const videoId = extractYouTubeId(input);
    if (!videoId) return input;

    // Force plain watch URL (fixes Mix links / start_radio / etc)
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return input;
  }
}

type SearchResultLike = any;

/**
 * Returns:
 * - tracks[] (may be empty)
 * - errorMessage if Lavalink explicitly errored
 * - playlistName if playlist
 */
function parseSearchResult(res: SearchResultLike): {
  tracks: any[];
  errorMessage?: string;
  playlistName?: string;
} {
  // lavalink-client variants tend to expose:
  // - res.tracks (array)
  // - res.loadType (string)
  // - res.exception?.message OR res.data?.message
  const tracks = Array.isArray(res?.tracks) ? res.tracks : [];

  const loadType = res?.loadType || res?.loadtype || res?.type;

  // Explicit error
  const errorMessage =
    res?.exception?.message ||
    res?.data?.message ||
    (loadType === "error" ? "Lavalink failed to load that track." : undefined);

  // Playlist detection (some libs: res.playlist?.name)
  const playlistName = res?.playlist?.name;

  return { tracks, errorMessage, playlistName };
}

/**
 * Search strategy:
 * 1) If input is a URL:
 *    - try direct URL first
 *    - if Lavalink errors or returns 0 tracks AND it's YouTube -> fall back to ytsearch:<videoId or original input>
 *    - if non-YouTube URL fails -> fall back to ytsearch:<original input> (so user still gets something)
 * 2) If input is not a URL: ytsearch:<input>
 */
async function smartSearch(player: any, input: string, requester: any) {
  const trimmed = input.trim();
  const url = isHttpUrl(trimmed) ? trimmed : null;

  // Non-URL: normal search
  if (!url) {
    return player.search({ query: `ytsearch:${trimmed}` }, requester);
  }

  // URL: normalize YouTube if applicable
  const normalizedUrl = normalizeYouTubeUrl(url);

  // 1) Try direct URL
  let res = await player.search({ query: normalizedUrl }, requester);
  let parsed = parseSearchResult(res);

  // If direct succeeded with tracks and no explicit error, done.
  if (!parsed.errorMessage && parsed.tracks.length > 0) {
    return res;
  }

  // 2) Fallback behavior
  const ytId = extractYouTubeId(normalizedUrl);

  // If YouTube URL failed, try searching by ID first (often works best on VPS)
  if (ytId) {
    res = await player.search({ query: `ytsearch:${ytId}` }, requester);
    parsed = parseSearchResult(res);
    if (!parsed.errorMessage && parsed.tracks.length > 0) return res;
  }

  // Final fallback: search the original text/url
  res = await player.search({ query: `ytsearch:${trimmed}` }, requester);
  return res;
}

// --------- command ---------

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const member = interaction.member as GuildMember | null;
  const voiceChannel = member?.voice?.channel;

  if (!interaction.guildId || !interaction.guild || !voiceChannel) {
    await interaction.editReply("Join a voice channel first, then run `/play`.");
    return;
  }

  const input = interaction.options.getString("url", true).trim();

  const player = lavalink.createPlayer({
    guildId: interaction.guildId,
    voiceChannelId: voiceChannel.id,
    textChannelId: interaction.channelId,
    selfDeaf: true,
    volume: 80,
  });

  await player.connect();

  const res = await smartSearch(player, input, interaction.user);
  const { tracks, errorMessage, playlistName } = parseSearchResult(res);

  // If Lavalink explicitly errored, show the real reason (not "no results")
  if (errorMessage && tracks.length === 0) {
    await interaction.editReply(`❌ Couldn’t load that: ${errorMessage}`);
    return;
  }

  const track = tracks[0];
  if (!track) {
    await interaction.editReply("❌ No results found for that.");
    return;
  }

  const wasPlaying = player.playing;

  // If you later want to queue the whole playlist, you can add tracks here.
  await player.queue.add(track);

  if (!wasPlaying) {
    await player.play();
  }

  const title = track?.info?.title ?? "Unknown track";

  await interaction.editReply(
    wasPlaying
      ? `➕ Added to queue: **${title}**${playlistName ? ` (from **${playlistName}**)` : ""}`
      : `▶️ Now playing: **${title}**${playlistName ? ` (from **${playlistName}**)` : ""}`
  );
}