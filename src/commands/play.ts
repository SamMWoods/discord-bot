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

function normalizeYouTubeUrl(url: string) {
  try {
    const u = new URL(url);

    // Only touch YouTube links
    const host = u.hostname.replace(/^www\./, "");
    const isYouTube =
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtu.be";

    if (!isYouTube) return url;

    // If it's a YouTube "Mix / radio" link, strip playlist/radio params
    const list = u.searchParams.get("list");
    const isMix = (list?.startsWith("RD") ?? false) || u.searchParams.has("start_radio");

    if (isMix) {
      u.searchParams.delete("list");
      u.searchParams.delete("start_radio");
      u.searchParams.delete("index");
      u.searchParams.delete("feature");
      return u.toString();
    }

    return url;
  } catch {
    return url;
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const member = interaction.member as GuildMember | null;
  const voiceChannel = member?.voice?.channel;

  if (!interaction.guildId || !interaction.guild || !voiceChannel) {
    await interaction.editReply("Join a voice channel first, then run `/play`.");
    return;
  }

  const input = interaction.options.getString("url", true).trim();

  const normalized =
    input.startsWith("http://") || input.startsWith("https://")
      ? normalizeYouTubeUrl(input)
      : input;

  const query =
    normalized.startsWith("http://") || normalized.startsWith("https://")
      ? normalized
      : `ytsearch:${normalized}`;

  const player = lavalink.createPlayer({
    guildId: interaction.guildId,
    voiceChannelId: voiceChannel.id,
    textChannelId: interaction.channelId,
    selfDeaf: true,
    volume: 80,
  });

  await player.connect();

  const res = await player.search({ query }, interaction.user);
  const track = res?.tracks?.[0];

  if (!track) {
    await interaction.editReply("No results found for that.");
    return;
  }

  const wasPlaying = player.playing;

  await player.queue.add(track);

  if (!wasPlaying) {
    await player.play();
  }

  await interaction.editReply(
    wasPlaying
      ? `➕ Added to queue: **${track.info.title}**`
      : `▶️ Now playing: **${track.info.title}**`
  );
}
