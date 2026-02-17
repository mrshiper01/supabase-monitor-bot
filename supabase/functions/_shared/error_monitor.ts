const DISCORD_EMBED_COLOR_ERROR = 15158332; // Rojo
const DEFAULT_PROJECT_NAME = "Proyecto Desconocido";
const DEFAULT_LOG_TABLE = "function_errors";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function formatDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function notifyDiscord(functionName: string, projectName: string, error: Error): Promise<void> {
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL no está configurada. No se envió notificación a Discord.");
    return;
  }

  const now = new Date();
  const body = {
    embeds: [
      {
        title: "🚨 Error en Edge Function",
        color: DISCORD_EMBED_COLOR_ERROR,
        fields: [
          { name: "Proyecto", value: projectName, inline: true },
          { name: "Nombre de la función", value: functionName, inline: true },
          { name: "Mensaje de error", value: error.message || String(error), inline: false },
          { name: "Fecha/Hora", value: formatDateTime(now), inline: true },
        ],
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("Error al enviar notificación a Discord:", res.status, await res.text());
  }
}

async function saveErrorInSupabase(functionName: string, projectName: string, error: Error): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const tableName = Deno.env.get("ERROR_LOG_TABLE") ?? DEFAULT_LOG_TABLE;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no está configurada. No se guardó el error en Supabase.",
    );
    return;
  }

  const restUrl = `${supabaseUrl}/rest/v1/${tableName}`;
  const payload = {
    project_name: projectName,
    function_name: functionName,
    error_message: error.message || String(error),
    error_stack: error.stack ?? null,
    occurred_at: new Date().toISOString(),
  };

  const res = await fetch(restUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Error al guardar log en Supabase:", res.status, await res.text());
  }
}

export async function notifyError(functionName: string, error: Error): Promise<void> {
  const projectName = Deno.env.get("PROJECT_NAME") ?? DEFAULT_PROJECT_NAME;
  const tasks = [
    notifyDiscord(functionName, projectName, error),
    saveErrorInSupabase(functionName, projectName, error),
  ];
  await Promise.allSettled(tasks);
}

type EdgeHandler = (request: Request) => Response | Promise<Response>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function withErrorMonitoring(functionName: string, handler: EdgeHandler): EdgeHandler {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      const normalizedError = toError(error);
      await notifyError(functionName, normalizedError);
      return new Response(
        JSON.stringify({ error: "Internal Server Error", function_name: functionName }),
        { status: 500, headers: { "Content-Type": JSON_CONTENT_TYPE } },
      );
    }
  };
}
