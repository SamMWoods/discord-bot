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

    if (host === "youtu.be") {
      const id = url.pathname.replace("/", "");
      return id ? `https://www.youtube.com/watch?v=${id}` : input;
    }

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

function getYouTubeId(str: string) {
  try {
    const u = new URL(str);
    const host = u.hostname.toLowerCase();

    if (host === "youtu.be") return u.pathname.replace("/", "");
    if (host.includes("youtube.com") || host.includes("music.youtube.com")) {
      return u.searchParams.get("v") || "";
    }

    return "";
  } catch {
    return "";
  }
}

async function getSpotifyOEmbedTitle(
  spotifyUrl: string
): Promise<string | null> {
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

function cleanSearchQuery(input: string) {
  return input
    .replace(/\(.*?\)/g, " ")
    .replace(/\[.*?\]/g, " ")
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

const spotifyTitleCache = new Map<string, { title: string; expires: number }>();
const SPOTIFY_CACHE_TTL_MS = 1000 * 60 * 60;

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
    let input = isUrl(raw) ? normalizeYouTubeUrl(raw) : raw;

    let sourceUsed: SourceUsed = isUrl(input) ? "unknown" : "youtube";
    let spotifyResolvedTitle: string | null = null;

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

    if (!isUrl(input)) {
      input = cleanSearchQuery(input);
    }

    const player = lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: 80,
    });

    player.voiceChannelId = voiceChannel.id;
    player.textChannelId = interaction.channelId;

    if (!player.connected) {
      await player.connect();
    }

    let res: any = null;
    let track: any = null;
    let primaryQuery = "";
    let fallbackQueries: string[] = [];

    if (isUrl(input) && isYouTubeLink(input)) {
      const ytId = getYouTubeId(input);

      // Best order for YouTube links:
      // 1) Try direct URL
      // 2) Try ytsearch with the video ID
      // 3) Try ytsearch with the cleaned raw URL text as a last resort
      primaryQuery = input;

      fallbackQueries = [
        ...(ytId ? [`ytsearch:${ytId}`] : []),
        `ytsearch:${cleanSearchQuery(raw)}`,
      ];

      sourceUsed = "youtube";
    } else if (isUrl(input)) {
      primaryQuery = input;
    } else {
      primaryQuery = `ytsearch:${input} audio`;
      fallbackQueries = [`ytsearch:${input}`];
    }

    // Primary attempt
    res = await player.search({ query: primaryQuery }, interaction.user);
    track = res?.tracks?.[0];

    // Fallback attempts
    if (!track) {
      for (const query of fallbackQueries) {
        res = await player.search({ query }, interaction.user);
        track = res?.tracks?.[0];
        if (track) break;
      }
    }

    // SoundCloud fallback only for text-based queries / Spotify converted text
    if (!track && !isUrl(input)) {
      res = await player.search({ query: `scsearch:${input}` }, interaction.user);
      track = res?.tracks?.[0];
      if (track) sourceUsed = "soundcloud";
    }

    // Final emergency fallback for Spotify links where oEmbed failed
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
        fallbackQueries,
        spotifyResolvedTitle,
        loadType: res?.loadType,
        tracks: res?.tracks?.length,
        exception: res?.exception,
      });

      await interaction.editReply("No results found from enabled sources on this server.");
      return;
    }

    const shouldStart =
      !player.playing && !player.paused && player.queue.tracks.length === 0;

    await player.queue.add(track);

    const badge = sourceBadge(sourceUsed);
    const suffix = badge ? `\n${badge}` : "";

    if (shouldStart) {
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