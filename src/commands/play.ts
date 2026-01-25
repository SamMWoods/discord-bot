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
  // Most commonly "Track - Artist"
  const parts = oembedTitle.split(" - ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const track = parts[0];
    const artist = parts.slice(1).join(" - ");
    return `${artist} - ${track}`;
  }
  return oembedTitle;
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

    // If Spotify link, convert to a YouTube search query by resolving title from oEmbed
    let forcedSourceLabel: string | null = null;
    let spotifyResolvedTitle: string | null = null;

    if (isUrl(raw) && isSpotifyLink(raw)) {
      spotifyResolvedTitle = await getSpotifyOEmbedTitle(raw);

      if (spotifyResolvedTitle) {
        input = normalizeSpotifyTitleForSearch(spotifyResolvedTitle);
        forcedSourceLabel = "Spotify→YouTube";
      } else {
        // If we can't resolve, we keep `input` as the raw URL.
        // Your lavalink may fail to load Spotify URLs (depending on plugins),
        // but we don't hard-fail here so your existing fallbacks still run.
      }
    }

    // Default behavior:
    // - If URL: use it directly
    // - If text: try YouTube search first (nice UX), then fallback to SoundCloud if it fails
    const primaryQuery = isUrl(input) ? input : `ytsearch:${input}`;

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
    let usedFallback = false;

    // If we started from Spotify but couldn't resolve oEmbed title, we can still try:
    // - Try extracting something meaningful and searching YouTube anyway.
    // This helps when oEmbed is down/blocked.
    if (!track && isUrl(raw) && isSpotifyLink(raw)) {
      const fallbackQuery = spotifyResolvedTitle
        ? `ytsearch:${normalizeSpotifyTitleForSearch(spotifyResolvedTitle)}`
        : null;

      if (fallbackQuery) {
        res = await player.search({ query: fallbackQuery }, interaction.user);
        track = res?.tracks?.[0];
        if (track) forcedSourceLabel = "Spotify→YouTube";
      }
    }

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

      // 3) If still nothing, fallback to SoundCloud search using the user text (NOT the URL)
      if (!track) {
        res = await player.search(
          { query: `scsearch:${ytId || "lose my mind"}` },
          interaction.user
        );
        track = res?.tracks?.[0];
        usedFallback = !!track;
      }
    }

    // 4) If text query ytsearch fails, fallback to SoundCloud
    if (!track && primaryQuery.startsWith("ytsearch:")) {
      res = await player.search({ query: `scsearch:${input}` }, interaction.user);
      track = res?.tracks?.[0];
      usedFallback = !!track;
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

    const sourceSuffix = forcedSourceLabel
      ? ` *(${forcedSourceLabel})*`
      : usedFallback
      ? " *(via SoundCloud)*"
      : "";

    if (!wasPlaying) {
      await player.play();
      await interaction.editReply(`▶️ Now playing: **${track.info.title}**${sourceSuffix}`);
    } else {
      await interaction.editReply(`➕ Added to queue: **${track.info.title}**${sourceSuffix}`);
    }
  } catch (err) {
    console.error("Play command error:", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("⚠️ Something went wrong trying to play that.");
    }
  }
}
