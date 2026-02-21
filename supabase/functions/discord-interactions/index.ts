import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyDiscordSignature } from "../_shared/discord_verify.ts";

const JSON_CT = "application/json; charset=utf-8";

// Discord interaction types
const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const INTERACTION_MESSAGE_COMPONENT = 3;

// Discord interaction response types
const RESPONSE_PONG = 1;
const RESPONSE_DEFERRED_CHANNEL_MESSAGE = 5;
const RESPONSE_UPDATE_MESSAGE = 7;
const RESPONSE_DEFERRED_UPDATE = 6;

const DEFAULT_LOG_TABLE = "function_errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FunctionError {
  id: number;
  function_name: string;
  business_day: string;
  status: string;
}

interface AuditConfig {
  id: number;
  display_name: string;
  function_name: string | null;
  target_table: string;
  date_column: string;
  date_column_type: string;
  sort_order: number;
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

async function fetchErrorsByDate(date: string): Promise<FunctionError[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tableName = Deno.env.get("ERROR_LOG_TABLE") ?? DEFAULT_LOG_TABLE;
  if (!supabaseUrl) return [];

  const url =
    `${supabaseUrl}/rest/v1/${tableName}?business_day=eq.${date}&status=in.(pending,notified)&select=id,function_name,business_day,status`;
  const res = await fetch(url, { headers: getSupabaseHeaders() });
  if (!res.ok) return [];
  return (await res.json()) as FunctionError[];
}

async function updateStatusByIds(ids: number[], status: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tableName = Deno.env.get("ERROR_LOG_TABLE") ?? DEFAULT_LOG_TABLE;
  if (!supabaseUrl || ids.length === 0) return;

  const url = `${supabaseUrl}/rest/v1/${tableName}?id=in.(${ids.join(",")})`;
  await fetch(url, {
    method: "PATCH",
    headers: { ...getSupabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ status, retried_at: new Date().toISOString() }),
  });
}

async function deleteByIds(ids: number[]): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tableName = Deno.env.get("ERROR_LOG_TABLE") ?? DEFAULT_LOG_TABLE;
  if (!supabaseUrl || ids.length === 0) return;

  const url = `${supabaseUrl}/rest/v1/${tableName}?id=in.(${ids.join(",")})`;
  await fetch(url, { method: "DELETE", headers: getSupabaseHeaders() });
}

async function deleteByDate(date: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tableName = Deno.env.get("ERROR_LOG_TABLE") ?? DEFAULT_LOG_TABLE;
  if (!supabaseUrl) return;

  const url =
    `${supabaseUrl}/rest/v1/${tableName}?business_day=eq.${date}&status=in.(pending,notified)`;
  await fetch(url, { method: "DELETE", headers: getSupabaseHeaders() });
}

async function fetchAuditConfigs(): Promise<AuditConfig[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return [];

  const url =
    `${supabaseUrl}/rest/v1/audit_config?is_active=eq.true&select=id,display_name,function_name,target_table,date_column,date_column_type,sort_order&order=sort_order.asc`;
  const res = await fetch(url, { headers: getSupabaseHeaders() });
  if (!res.ok) return [];
  return (await res.json()) as AuditConfig[];
}

/**
 * Counts rows in a table for a given date using a HEAD + Prefer:count=exact request.
 * Returns null if the query fails (table error, missing column, etc.).
 */
async function countTableRecords(
  tableName: string,
  dateColumn: string,
  dateColumnType: string,
  date: string,
): Promise<number | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return null;

  let filter: string;
  if (dateColumnType === "timestamp") {
    const nextDay = getNextDay(date);
    filter = `${dateColumn}=gte.${date}T00:00:00Z&${dateColumn}=lt.${nextDay}T00:00:00Z`;
  } else {
    filter = `${dateColumn}=eq.${date}`;
  }

  const url = `${supabaseUrl}/rest/v1/${tableName}?${filter}&select=id`;
  const res = await fetch(url, {
    method: "HEAD",
    headers: { ...getSupabaseHeaders(), Prefer: "count=exact" },
  });
  if (!res.ok) return null;

  const contentRange = res.headers.get("content-range");
  const match = contentRange?.match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

function getYesterdayDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function getNextDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Edge function re-execution
// ---------------------------------------------------------------------------

async function retryFunction(functionName: string, businessDay: string): Promise<boolean> {
  const baseUrl = Deno.env.get("FUNCTIONS_BASE_URL");
  const invokeKey = Deno.env.get("FUNCTION_INVOKE_KEY");

  if (!baseUrl || !invokeKey) {
    console.error("FUNCTIONS_BASE_URL o FUNCTION_INVOKE_KEY no disponibles.");
    return false;
  }

  try {
    const res = await fetch(`${baseUrl}/${functionName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${invokeKey}`,
        apikey: invokeKey,
        "Content-Type": "application/json",
        "X-Business-Day": businessDay,
      },
      body: JSON.stringify({}),
    });
    console.log(`Retry ${functionName} → ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error(`Error al reintentar función ${functionName}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Discord response builders
// ---------------------------------------------------------------------------

function discordResponse(content: object): Response {
  return new Response(JSON.stringify(content), {
    status: 200,
    headers: { "Content-Type": JSON_CT },
  });
}

function deferredUpdate(): Response {
  return discordResponse({ type: RESPONSE_DEFERRED_UPDATE });
}

function updatedMessage(description: string, color: number): object {
  return {
    type: RESPONSE_UPDATE_MESSAGE,
    data: {
      embeds: [{ description, color }],
      components: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Follow-up PATCH to edit the original Discord message after deferred response
// ---------------------------------------------------------------------------

async function patchInteractionMessage(token: string, content: object): Promise<void> {
  const appId = Deno.env.get("DISCORD_APPLICATION_ID");
  if (!appId) {
    console.error("DISCORD_APPLICATION_ID no configurado.");
    return;
  }
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(content),
  });
  if (!res.ok) {
    console.error("Error al actualizar mensaje Discord:", res.status, await res.text());
  }
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

async function handleRetryAll(date: string, token: string): Promise<Response> {
  const errors = await fetchErrorsByDate(date);

  if (errors.length === 0) {
    return discordResponse(
      updatedMessage(
        `ℹ️ No hay errores pendientes para \`${date}\` (puede que ya hayan sido procesados).`,
        0x95A5A6,
      ),
    );
  }

  // Respond to Discord immediately to avoid 3-second timeout
  const response = deferredUpdate();

  // Process retries after returning the response
  (async () => {
    await updateStatusByIds(errors.map((e) => e.id), "retrying");

    const succeeded: string[] = [];
    const failed: string[] = [];

    for (const err of errors) {
      const ok = await retryFunction(err.function_name, date);
      if (ok) {
        succeeded.push(err.function_name);
      } else {
        failed.push(err.function_name);
      }
    }

    // Delete successful rows
    const successIds = errors
      .filter((e) => succeeded.includes(e.function_name))
      .map((e) => e.id);
    if (successIds.length > 0) await deleteByIds(successIds);

    // Reset failed rows to pending so monitor-errors picks them up again
    const failedIds = errors
      .filter((e) => failed.includes(e.function_name))
      .map((e) => e.id);
    if (failedIds.length > 0) await updateStatusByIds(failedIds, "pending");

    // Build summary
    let description: string;
    let color: number;

    if (failed.length === 0) {
      description =
        `✅ **Backfill completo para \`${date}\`**\nTodas las funciones (${succeeded.length}) ejecutadas correctamente.`;
      color = 0x2ECC71;
    } else if (succeeded.length === 0) {
      description =
        `❌ **Backfill fallido para \`${date}\`**\nNinguna función pudo ejecutarse:\n${failed.map((f) => `• \`${f}\``).join("\n")}`;
      color = 0xE74C3C;
    } else {
      const okList = succeeded.map((f) => `• \`${f}\``).join("\n");
      const failList = failed.map((f) => `• \`${f}\``).join("\n");
      description =
        `⚠️ **Backfill parcial para \`${date}\`**\n\n✅ Correctas (${succeeded.length}):\n${okList}\n\n❌ Fallidas (${failed.length}):\n${failList}`;
      color = 0xF39C12;
    }

    await patchInteractionMessage(token, {
      embeds: [{ description, color }],
      components: [],
    });
  })();

  return response;
}

async function handleRejectAll(date: string): Promise<Response> {
  await deleteByDate(date);
  return discordResponse(
    updatedMessage(
      `🗑️ **Errores ignorados para \`${date}\`**\nTodos los registros de esa fecha han sido eliminados.`,
      0x95A5A6,
    ),
  );
}

// ---------------------------------------------------------------------------
// Audit command handler
// ---------------------------------------------------------------------------

async function handleAuditCommand(token: string): Promise<Response> {
  const immediate = new Response(
    JSON.stringify({ type: RESPONSE_DEFERRED_CHANNEL_MESSAGE }),
    { status: 200, headers: { "Content-Type": JSON_CT } },
  );

  (async () => {
    const date = getYesterdayDate();

    const [configs, errors] = await Promise.all([
      fetchAuditConfigs(),
      fetchErrorsByDate(date),
    ]);

    // Count all configured tables in parallel
    const counts = await Promise.all(
      configs.map((c) =>
        countTableRecords(c.target_table, c.date_column, c.date_column_type, date)
      ),
    );

    // function_name → error count
    const errorsByFn = new Map<string, number>();
    for (const err of errors) {
      errorsByFn.set(err.function_name, (errorsByFn.get(err.function_name) ?? 0) + 1);
    }

    const lines: string[] = [];
    let totalRecords = 0;
    let totalOk = 0;
    let totalErr = 0;

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const count = counts[i];
      const errCount = cfg.function_name ? (errorsByFn.get(cfg.function_name) ?? 0) : 0;

      if (cfg.function_name) errorsByFn.delete(cfg.function_name);

      if (count === null) {
        lines.push(`⚠️ \`${cfg.display_name}\` — error al consultar tabla`);
        totalErr++;
      } else if (errCount > 0) {
        lines.push(
          `⚠️ \`${cfg.display_name}\` — ${count.toLocaleString()} registros (${errCount} error${errCount !== 1 ? "es" : ""})`,
        );
        totalRecords += count;
        totalOk++;
      } else {
        lines.push(`✅ \`${cfg.display_name}\` — ${count.toLocaleString()} registros`);
        totalRecords += count;
        totalOk++;
      }
    }

    // Functions with errors not linked to any audit_config entry
    for (const [fn, errCount] of errorsByFn) {
      lines.push(`❌ \`${fn}\` — falló (${errCount} error${errCount !== 1 ? "es" : ""})`);
      totalErr++;
    }

    let description: string;
    let color: number;

    if (lines.length === 0) {
      description =
        `📊 **Auditoría — \`${date}\`**\n\nℹ️ Sin configuración de auditoría activa.`;
      color = 0x95A5A6;
    } else {
      const footer = [
        `📈 **${totalRecords.toLocaleString()}** registros totales`,
        totalOk > 0 ? `✅ ${totalOk} OK` : null,
        totalErr > 0 ? `❌ ${totalErr} con errores` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      description =
        `📊 **Auditoría — \`${date}\`**\n\n${lines.join("\n")}\n\n─────────────────────────\n${footer}`;

      color = totalErr === 0 ? 0x2ECC71 : totalOk === 0 ? 0xE74C3C : 0xF39C12;
    }

    await patchInteractionMessage(token, { embeds: [{ description, color }] });
  })();

  return immediate;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const publicKey = Deno.env.get("DISCORD_PUBLIC_KEY");
  if (!publicKey) {
    console.error("DISCORD_PUBLIC_KEY no configurada.");
    return new Response("Server configuration error", { status: 500 });
  }

  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  const rawBody = await req.text();

  const isValid = await verifyDiscordSignature(publicKey, signature, timestamp, rawBody);
  if (!isValid) {
    return new Response("Invalid request signature", { status: 401 });
  }

  const body = JSON.parse(rawBody) as {
    type: number;
    token: string;
    data?: { custom_id?: string; name?: string };
  };

  // Discord ping — must respond with PONG to register the interactions endpoint
  if (body.type === INTERACTION_PING) {
    return discordResponse({ type: RESPONSE_PONG });
  }

  if (body.type === INTERACTION_APPLICATION_COMMAND) {
    const commandName = body.data?.name ?? "";
    if (commandName === "audit") return await handleAuditCommand(body.token);
    return new Response("Unknown command", { status: 400 });
  }

  if (body.type === INTERACTION_MESSAGE_COMPONENT) {
    const customId = body.data?.custom_id ?? "";
    const colonIdx = customId.indexOf(":");
    const action = customId.slice(0, colonIdx);
    const param = customId.slice(colonIdx + 1);

    if (!action || !param) {
      return discordResponse(updatedMessage("⚠️ Formato de botón inválido.", 0xFFA500));
    }

    if (action === "retry_all") return await handleRetryAll(param, body.token);
    if (action === "reject_all") return await handleRejectAll(param);

    return discordResponse(updatedMessage("⚠️ Acción desconocida.", 0xFFA500));
  }

  return new Response("Unhandled interaction type", { status: 400 });
});
