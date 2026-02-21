import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const JSON_CT = "application/json; charset=utf-8";
const DISCORD_EMBED_COLOR_ERROR = 15158332; // red
const DEFAULT_LOG_TABLE = "function_errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FunctionError {
  id: number;
  function_name: string;
  error_message: string;
  business_day: string; // YYYY-MM-DD
  status: string;
  occurred_at: string;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function getSupabaseHeaders(): Record<string, string> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

async function fetchPendingErrors(): Promise<FunctionError[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tableName = Deno.env.get("ERROR_LOG_TABLE") ?? DEFAULT_LOG_TABLE;
  if (!supabaseUrl) return [];

  const url =
    `${supabaseUrl}/rest/v1/${tableName}?status=eq.pending&select=id,function_name,error_message,business_day,status,occurred_at&order=business_day.asc,occurred_at.asc`;
  const res = await fetch(url, { headers: getSupabaseHeaders() });
  if (!res.ok) {
    console.error("Error fetching pending errors:", res.status, await res.text());
    return [];
  }
  return (await res.json()) as FunctionError[];
}

async function markAsNotified(ids: number[]): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tableName = Deno.env.get("ERROR_LOG_TABLE") ?? DEFAULT_LOG_TABLE;
  if (!supabaseUrl || ids.length === 0) return;

  const idList = ids.join(",");
  const url = `${supabaseUrl}/rest/v1/${tableName}?id=in.(${idList})`;
  await fetch(url, {
    method: "PATCH",
    headers: { ...getSupabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ status: "notified" }),
  });
}

// ---------------------------------------------------------------------------
// Discord helpers
// ---------------------------------------------------------------------------

async function sendDiscordReport(
  date: string,
  errors: FunctionError[],
): Promise<void> {
  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const channelId = Deno.env.get("DISCORD_CHANNEL_ID");

  if (!botToken || !channelId) {
    console.error("DISCORD_BOT_TOKEN o DISCORD_CHANNEL_ID no configurados.");
    return;
  }

  const functionList = errors
    .map((e) => `• \`${e.function_name}\``)
    .join("\n");

  const embed = {
    title: `🚨 Errores sin procesar — ${date}`,
    color: DISCORD_EMBED_COLOR_ERROR,
    description: `**${errors.length} función(es) fallaron** para el día hábil \`${date}\`:\n\n${functionList}`,
    footer: { text: `Usa los botones para reintentar o ignorar todos los errores de esta fecha.` },
  };

  const body = {
    embeds: [embed],
    components: [
      {
        type: 1, // ACTION_ROW
        components: [
          {
            type: 2, // BUTTON
            style: 3, // SUCCESS (green)
            label: `✅ Reintentar todo ${date}`,
            custom_id: `retry_all:${date}`,
          },
          {
            type: 2, // BUTTON
            style: 4, // DANGER (red)
            label: "❌ Ignorar todo",
            custom_id: `reject_all:${date}`,
          },
        ],
      },
    ],
  };

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(
      `Error al enviar reporte Discord para ${date}:`,
      res.status,
      await res.text(),
    );
  } else {
    console.log(`Reporte Discord enviado para ${date} (${errors.length} errores).`);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (_req: Request): Promise<Response> => {
  const pending = await fetchPendingErrors();

  if (pending.length === 0) {
    console.log("No hay errores pendientes.");
    return new Response(
      JSON.stringify({ message: "No hay errores pendientes." }),
      { status: 200, headers: { "Content-Type": JSON_CT } },
    );
  }

  // Group errors by business_day
  const byDate = new Map<string, FunctionError[]>();
  for (const err of pending) {
    const date = err.business_day ?? "sin-fecha";
    const group = byDate.get(date) ?? [];
    group.push(err);
    byDate.set(date, group);
  }

  const results: { date: string; count: number }[] = [];

  for (const [date, errors] of byDate) {
    await sendDiscordReport(date, errors);
    await markAsNotified(errors.map((e) => e.id));
    results.push({ date, count: errors.length });
  }

  return new Response(
    JSON.stringify({ reported: results }),
    { status: 200, headers: { "Content-Type": JSON_CT } },
  );
});
