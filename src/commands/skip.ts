import {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { lavalink } from "../lavalink";

export const data = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current song");

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

  // If your lib exposes a playing flag, keep this (optional)
  // @ts-ignore (only if TS complains)
  if (player.playing === false) {
    await interaction.editReply("Nothing is playing right now.");
    return;
  }

  // ✅ Skip = stop current track, stay connected so queue continues
  await player.skip();

  await interaction.editReply("⏭️ Skipped!");
}
