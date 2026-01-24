import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

type Champ = {
  name: string;
  tags: string[];
};

let cachedChamps: Champ[] | null = null;
let cacheExpiresAt = 0;

async function fetchChampions(): Promise<Champ[]> {
  const now = Date.now();

  if (cachedChamps && now < cacheExpiresAt) {
    return cachedChamps;
  }

  // Get latest Data Dragon version
  const versionsRes = await fetch(
    "https://ddragon.leagueoflegends.com/api/versions.json"
  );
  const versions = (await versionsRes.json()) as string[];
  const latest = versions[0];

  // Fetch champion list
  const champsRes = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`
  );
  const champsJson = (await champsRes.json()) as {
    data: Record<string, Champ>;
  };

  cachedChamps = Object.values(champsJson.data);
  cacheExpiresAt = now + 60 * 60 * 1000; // 1 hour cache

  return cachedChamps;
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const data = new SlashCommandBuilder()
  .setName("gimmeachamp")
  .setDescription("Picks a random League of Legends champion")
  .addStringOption((opt) =>
    opt
      .setName("role")
      .setDescription("Filter by role (Top, Jungle, Mid, ADC, Support)")
      .setRequired(false)
      .addChoices(
        { name: "Top", value: "Top" },
        { name: "Jungle", value: "Jungle" },
        { name: "Mid", value: "Mid" },
        { name: "ADC", value: "ADC" },
        { name: "Support", value: "Support" }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    const role = interaction.options.getString("role");
    const champs = await fetchChampions();

    let pool = champs;

    // Role → tag mapping (Riot uses these internally)
    if (role) {
      const roleTagMap: Record<string, string[]> = {
        Top: ["Fighter", "Tank"],
        Jungle: ["Assassin", "Fighter", "Tank"],
        Mid: ["Mage", "Assassin"],
        ADC: ["Marksman"],
        Support: ["Support", "Tank", "Mage"],
      };

      const allowedTags = roleTagMap[role];

      pool = champs.filter((c) =>
        c.tags.some((tag) => allowedTags.includes(tag))
      );
    }

    if (!pool.length) {
      await interaction.editReply(
        `❌ No champions found for role **${role}**`
      );
      return;
    }

    const champ = randomFrom(pool);

    await interaction.editReply(
      role
        ? `🎯 **${role} pick:** **${champ.name}**`
        : `🎲 **Random champ:** **${champ.name}**`
    );
  } catch (err) {
    await interaction.editReply(
      "⚠️ Failed to fetch champions. Try again in a moment."
    );
  }
}
