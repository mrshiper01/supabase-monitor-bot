#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net
/**
 * Envía una alerta de error de prueba a Discord (sin tocar la DB).
 * Requiere DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID, o DISCORD_WEBHOOK_URL en .env
 */

// Cargar .env si existe
async function loadEnv(): Promise<void> {
  try {
    const envPath = new URL("../.env", import.meta.url);
    const content = await Deno.readTextFile(envPath);
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
          Deno.env.set(key, val);
        }
      }
    }
  } catch {
    // .env no existe o no se puede leer
  }
}

const DISCORD_EMBED_COLOR_ERROR = 15158332; // red

// Datos de ejemplo (como si vinieran de test-alerta con fail=1)
const businessDay = new Date().toISOString().slice(0, 10);
const testError = {
  id: 999,
  function_name: "test-alerta",
  error_message: `Fallo de prueba para Discord (businessDay: ${businessDay})`,
  business_day: businessDay,
  status: "pending",
  occurred_at: new Date().toISOString(),
};

const errors = [testError];

// Mismo formato que monitor-errors
const functionList = errors
  .map((e) => `• \`${e.function_name}\``)
  .join("\n");

const embed = {
  title: `🚨 Errores sin procesar — ${businessDay}`,
  color: DISCORD_EMBED_COLOR_ERROR,
  description: `**${errors.length} función(es) fallaron** para el día hábil \`${businessDay}\`:\n\n${functionList}`,
  footer: {
    text: "Usa los botones para reintentar o ignorar todos los errores de esta fecha.",
  },
};

const discordPayload = {
  embeds: [embed],
  components: [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: `✅ Reintentar todo ${businessDay}`,
          custom_id: `retry_all:${businessDay}`,
        },
        {
          type: 2,
          style: 4,
          label: "❌ Ignorar todo",
          custom_id: `reject_all:${businessDay}`,
        },
      ],
    },
  ],
};

async function sendToDiscord(): Promise<boolean> {
  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const channelId = Deno.env.get("DISCORD_CHANNEL_ID");
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");

  if (botToken && channelId) {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify(discordPayload),
      },
    );
    if (!res.ok) {
      console.error("Error al enviar a Discord:", res.status, await res.text());
      return false;
    }
    return true;
  }

  if (webhookUrl && webhookUrl.includes("discord.com/api/webhooks/")) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
    });
    if (!res.ok) {
      console.error("Error al enviar webhook:", res.status, await res.text());
      return false;
    }
    return true;
  }

  console.error(
    "Configura DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID, o DISCORD_WEBHOOK_URL en .env",
  );
  return false;
}

await loadEnv();

console.log("\n📋 Error de prueba:");
console.log(`   Función: ${testError.function_name}`);
console.log(`   Mensaje: ${testError.error_message}`);
console.log(`   Día hábil: ${testError.business_day}`);
console.log("\n📤 Enviando a Discord...");

if (await sendToDiscord()) {
  console.log("✅ Alerta enviada correctamente.\n");
} else {
  Deno.exit(1);
}
