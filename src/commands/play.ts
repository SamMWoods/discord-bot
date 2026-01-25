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

function normalizeYouTubeUrl(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();

    const isYouTube =
      host.includes("youtube.com") ||
      host === "youtu.be" ||
      host.includes("music.youtube.com");

    if (!isYouTube) return input;

    // youtu.be/<id>
    if (host === "youtu.be") {
      const id = url.pathname.replace("/", "");
      return id ? `https://www.youtube.com/watch?v=${id}` : input;
    }

    // youtube.com/watch?v=<id>
    const v = url.searchParams.get("v");
    if (v) return `https://www.youtube.com/watch?v=${v}`;

    return input;
  } catch {
    return input;
  }
}

function isUrl(str: string) {
  return str.startsWith("http://") || str.startsWith("https://");
}

function isYouTubeLink(str: string) {
  return (
    str.includes("youtube.com") ||
    str.includes("youtu.be") ||
    str.includes("music.youtube.com")
  );
}

function isSpotifyLink(str: string) {
  return (
    str.includes("open.spotify.com/track/") ||
    str.includes("open.spotify.com/album/") ||
    str.includes("open.spotify.com/playlist/") ||
    str.includes("open.spotify.com/episode/") ||
    str.includes("open.spotify.com/show/")
  );
}

/**
 * Uses Spotify's oEmbed endpoint to resolve a Spotify URL to a human-friendly title.
 * Track oEmbed titles are usually: "Track Name - Artist Name"
 *
 * Requires Node 18+ for global fetch.
 * If you're on Node <18, install node-fetch and import it.
 */
async function getSpotifyOEmbedTitle(spotifyUrl: string): Promise<string | null> {
  try {
    const oembed = `https://open.spotify.com/oembed?url=${encodeURIComponent(
      spotifyUrl
    )}`;

    const res = await fetch(oembed, {
      headers: { accept: "application/json" },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { title?: string };
    const title = data?.title?.trim();
    return title ? title : null;
  } catch {
    return null;
  }
}

/**
 * Optional: improves hit rate on YouTube a bit.
 * Spotify track titles come like "Song - Artist".
 * YouTube is often better with "Artist - Song".
 */
function normalizeSpotifyTitleForSearch(oembedTitle: string) {
  const parts = oembedTitle
    .split(" - ")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const track = parts[0];
    const artist = parts.slice(1).join(" - ");
    return `${artist} - ${track}`;
  }

  return oembedTitle;
}

/**
 * Removes noisy tokens that often hurt YouTube matching.
 * Adds "audio" when searching to prefer clean uploads.
 */
function cleanSearchQuery(input: string) {
  return input
    .replace(/\(.*?\)/g, " ") // (Remastered 2019)
    .replace(/\[.*?\]/g, " ") // [Official Video]
    .replace(/official video/gi, " ")
    .replace(/official music video/gi, " ")
    .replace(/lyrics?/gi, " ")
    .replace(/\bmv\b/gi, " ")
    .replace(/remaster(ed)?/gi, " ")
    .replace(/topic/gi, " ")
    .replace(/visualizer/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type SourceUsed = "youtube" | "soundcloud" | "spotify_to_youtube" | "unknown";

function sourceBadge(source: SourceUsed) {
  switch (source) {
    case "spotify_to_youtube":
      return "🟢 Spotify → 🔴 YouTube";
    case "soundcloud":
      return "🟠 SoundCloud";
    case "youtube":
      return "🔴 YouTube";
    default:
      return "";
  }
}

/**
 * Simple in-memory cache for Spotify oEmbed titles.
 * Note: resets when your bot process restarts.
 */
const spotifyTitleCache = new Map<string, { title: string; expires: number }>();
const SPOTIFY_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function getCachedSpotifyTitle(url: string) {
  const entry = spotifyTitleCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    spotifyTitleCache.delete(url);
    return null;
  }
  return entry.title;
}

function setCachedSpotifyTitle(url: string, title: string) {
  spotifyTitleCache.set(url, {
    title,
    expires: Date.now() + SPOTIFY_CACHE_TTL_MS,
  });
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;

    if (!interaction.guildId || !interaction.guild || !voiceChannel) {
      await interaction.editReply("Join a voice channel first, then run `/play`.");
      return;
    }

    const raw = interaction.options.getString("url", true).trim();

    // Normalize YouTube URLs early (if it is a YouTube url)
    let input = isUrl(raw) ? normalizeYouTubeUrl(raw) : raw;

    let sourceUsed: SourceUsed = isUrl(input) ? "unknown" : "youtube";
    let spotifyResolvedTitle: string | null = null;

    // If Spotify link, convert to a YouTube search query by resolving title from oEmbed
    if (isUrl(raw) && isSpotifyLink(raw)) {
      const cached = getCachedSpotifyTitle(raw);
      spotifyResolvedTitle = cached ?? (await getSpotifyOEmbedTitle(raw));

      if (spotifyResolvedTitle && !cached) {
        setCachedSpotifyTitle(raw, spotifyResolvedTitle);
      }

      if (spotifyResolvedTitle) {
        const normalized = normalizeSpotifyTitleForSearch(spotifyResolvedTitle);
        input = cleanSearchQuery(normalized);
        sourceUsed = "spotify_to_youtube";
      }
    }

    // If it's a text query, clean it for better matching too
    if (!isUrl(input)) {
      input = cleanSearchQuery(input);
    }

    // Default behavior:
    // - If URL: use it directly
    // - If text: try YouTube search first (nice UX), then fallback to SoundCloud if it fails
    const primaryQuery = isUrl(input) ? input : `ytsearch:${input} audio`;

    const player = lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: 80,
    });

    await player.connect();

    // 1) Try primary
    let res = await player.search({ query: primaryQuery }, interaction.user);
    let track = res?.tracks?.[0];

    // 2) If YouTube URL failed, try ytsearch using the video id (more reliable than direct URL)
    if (!track && isUrl(input) && isYouTubeLink(input)) {
      const ytId = (() => {
        try {
          const u = new URL(input);
          if (u.hostname === "youtu.be") return u.pathname.replace("/", "");
          return u.searchParams.get("v") || "";
        } catch {
          return "";
        }
      })();

      if (ytId) {
        res = await player.search({ query: `ytsearch:${ytId}` }, interaction.user);
        track = res?.tracks?.[0];
      }
    }

    // 3) If text query ytsearch fails, fallback to SoundCloud
    if (!track && !isUrl(input)) {
      res = await player.search({ query: `scsearch:${input}` }, interaction.user);
      track = res?.tracks?.[0];
      if (track) sourceUsed = "soundcloud";
    }

    // 4) If still nothing and we started from Spotify but oEmbed failed, last-ditch try:
    //    search YouTube using the Spotify URL token (sometimes users paste weird variants)
    if (!track && isSpotifyLink(raw) && !spotifyResolvedTitle) {
      res = await player.search({ query: `ytsearch:${raw}` }, interaction.user);
      track = res?.tracks?.[0];
      if (track) sourceUsed = "spotify_to_youtube";
    }

    if (!track) {
      console.log("[/play] No track found", {
        raw,
        input,
        primaryQuery,
        spotifyResolvedTitle,
        loadType: (res as any)?.loadType,
        tracks: res?.tracks?.length,
        exception: (res as any)?.exception,
      });

      await interaction.editReply("No results found from enabled sources on this server.");
      return;
    }

    const wasPlaying = player.playing;

    await player.queue.add(track);

    const badge = sourceBadge(sourceUsed);
    const suffix = badge ? `\n${badge}` : "";

    if (!wasPlaying) {
      await player.play();
      await interaction.editReply(`▶️ Now playing: **${track.info.title}**${suffix}`);
    } else {
      await interaction.editReply(`➕ Added to queue: **${track.info.title}**${suffix}`);
    }
  } catch (err) {
    console.error("Play command error:", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("⚠️ Something went wrong trying to play that.");
    }
  }
}