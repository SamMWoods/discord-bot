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

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const member = interaction.member as GuildMember | null;
  const voiceChannel = member?.voice?.channel;

  if (!interaction.guildId || !interaction.guild || !voiceChannel) {
    await interaction.editReply("Join a voice channel first, then run `/play`.");
    return;
  }

  const input = interaction.options.getString("url", true).trim();

  const query =
    input.startsWith("http://") || input.startsWith("https://")
      ? input
      : `ytsearch:${input}`;

  const player = lavalink.createPlayer({
    guildId: interaction.guildId,
    voiceChannelId: voiceChannel.id,
    textChannelId: interaction.channelId,
    selfDeaf: true,
    volume: 80,
  });

  await player.connect();

  // ✅ search is on the player, not the manager
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
    await interaction.editReply(`▶️ Now playing: **${track.info.title}**`);
  } else {
    await interaction.editReply(`➕ Added to queue: **${track.info.title}**`);
  }
}