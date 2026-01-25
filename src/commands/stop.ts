import {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { lavalink } from "../lavalink";

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop the music and clear the queue");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  if (!interaction.guildId) {
    await interaction.editReply("This command can only be used in a server.");
    return;
  }

  const member = interaction.member as GuildMember | null;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.editReply("Join a voice channel first.");
    return;
  }

  const player = lavalink.getPlayer(interaction.guildId);

  if (!player) {
    await interaction.editReply("Nothing is playing right now.");
    return;
  }

  // ✅ Stop playback safely
  await player.stop();

  // ✅ Clear queue (if anything is left)
  player.queue.clear();

  // ✅ Leave voice & destroy player
  await player.disconnect();
  await player.destroy();

  await interaction.editReply("⏹️ Music stopped and queue cleared.");
}
