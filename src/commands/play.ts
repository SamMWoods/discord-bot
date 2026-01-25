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
      host.includes("youtube.com") || host === "youtu.be" || host.includes("music.youtube.com");

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
    const input = isUrl(raw) ? normalizeYouTubeUrl(raw) : raw;

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
        res = await player.search({ query: `scsearch:${ytId || "lose my mind"}` }, interaction.user);
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
        loadType: (res as any)?.loadType,
        tracks: res?.tracks?.length,
        exception: (res as any)?.exception,
      });

      await interaction.editReply(
        "No results found from enabled sources on this server."
      );
      return;
    }

    const wasPlaying = player.playing;

    await player.queue.add(track);

    if (!wasPlaying) {
      await player.play();
      await interaction.editReply(
        `▶️ Now playing: **${track.info.title}**${usedFallback ? " *(via SoundCloud)*" : ""}`
      );
    } else {
      await interaction.editReply(
        `➕ Added to queue: **${track.info.title}**${usedFallback ? " *(via SoundCloud)*" : ""}`
      );
    }
  } catch (err) {
    console.error("Play command error:", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("⚠️ Something went wrong trying to play that.");
    }
  }
}
