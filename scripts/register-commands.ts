#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net

/**
 * Registra los slash commands del bot en Discord.
 * Ejecutar una vez (o cuando se agreguen/modifiquen comandos):
 *
 *   deno run --allow-env --allow-read --allow-net scripts/register-commands.ts
 *
 * O con el script de npm:
 *
 *   npm run register-commands
 */

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

// Cargar variables de entorno desde .env
await load({ export: true, allowEmptyValues: true }).catch(() => {
  // Ignorar si no existe .env (puede que las vars ya estén en el entorno)
});

const applicationId = Deno.env.get("DISCORD_APPLICATION_ID");
const botToken = Deno.env.get("DISCORD_BOT_TOKEN");

if (!applicationId || !botToken) {
  console.error(
    "❌ DISCORD_APPLICATION_ID y DISCORD_BOT_TOKEN deben estar configurados en .env",
  );
  Deno.exit(1);
}

const commands = [
  {
    name: "audit",
    description: "Resumen del día anterior: tablas procesadas y cantidad de registros por función",
    type: 1, // CHAT_INPUT
  },
];

console.log(`📡 Registrando ${commands.length} comando(s) para la aplicación ${applicationId}...`);

const res = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  },
);

if (res.ok) {
  const data = await res.json() as Array<{ name: string; id: string }>;
  console.log("✅ Comandos registrados correctamente:");
  for (const cmd of data) {
    console.log(`   • /${cmd.name}  (id: ${cmd.id})`);
  }
} else {
  const text = await res.text();
  console.error(`❌ Error al registrar comandos (HTTP ${res.status}):`, text);
  Deno.exit(1);
}
