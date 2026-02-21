const DEFAULT_PROJECT_NAME = "Proyecto Desconocido";
const DEFAULT_LOG_TABLE = "function_errors";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function toDateString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Returns the business day a function was supposed to process.
 * By convention, functions always process data from the previous calendar day,
 * so businessDay = occurred_at − 1 day.
 */
function calcBusinessDay(occurredAt: Date): Date {
  const d = new Date(occurredAt);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * Reads the business day from a request's `X-Business-Day` header or
 * `business_day` query param. Falls back to yesterday if neither is present.
 * Format expected/returned: YYYY-MM-DD
 */
export function getBusinessDay(req: Request): string {
  const fromHeader = req.headers.get("X-Business-Day");
  if (fromHeader) return fromHeader;

  const fromQuery = new URL(req.url).searchParams.get("business_day");
  if (fromQuery) return fromQuery;

  return toDateString(calcBusinessDay(new Date()));
}

// ---------------------------------------------------------------------------
// Supabase persistence
// ---------------------------------------------------------------------------

/**
 * Saves the error to `function_errors` and returns the new row ID.
 * Returns null if the insert fails or credentials are missing.
 */
async function saveErrorInSupabase(
  functionName: string,
  projectName: string,
  error: Error,
  businessDay: string,
): Promise<number | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const tableName = Deno.env.get("ERROR_LOG_TABLE") ?? DEFAULT_LOG_TABLE;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no está configurada. No se guardó el error en Supabase.",
    );
    return null;
  }

  const restUrl = `${supabaseUrl}/rest/v1/${tableName}`;
  const occurredAt = new Date();

  const payload = {
    project_name: projectName,
    function_name: functionName,
    error_message: error.message || String(error),
    error_stack: error.stack ?? null,
    occurred_at: occurredAt.toISOString(),
    business_day: businessDay,
    status: "pending",
  };

  const res = await fetch(restUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Error al guardar log en Supabase:", res.status, await res.text());
    return null;
  }

  const rows = await res.json() as Array<{ id: number }>;
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Supabase — successful run persistence
// ---------------------------------------------------------------------------

async function saveRunInSupabase(
  functionName: string,
  projectName: string,
  recordCount: number,
  businessDay: string,
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no está configurada. No se guardó la ejecución exitosa.",
    );
    return;
  }

  const payload = {
    project_name: projectName,
    function_name: functionName,
    business_day: businessDay,
    record_count: recordCount,
    ran_at: new Date().toISOString(),
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/function_runs`, {
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
    console.error("Error al guardar ejecución exitosa en Supabase:", res.status, await res.text());
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function notifyError(
  functionName: string,
  error: Error,
  businessDay?: string,
): Promise<void> {
  const projectName = Deno.env.get("PROJECT_NAME") ?? DEFAULT_PROJECT_NAME;
  const resolvedBusinessDay = businessDay ?? toDateString(calcBusinessDay(new Date()));
  await saveErrorInSupabase(functionName, projectName, error, resolvedBusinessDay);
}

/**
 * Registra una ejecución exitosa con el conteo de registros procesados.
 * Llamar al final de cada función edge cuando termina sin errores.
 *
 * @param functionName  Nombre de la función edge (debe ser consistente con el usado en withErrorMonitoring)
 * @param recordCount   Cantidad de registros procesados/traídos en esta ejecución
 * @param businessDay   Día hábil procesado (YYYY-MM-DD). Por defecto: ayer.
 */
export async function notifySuccess(
  functionName: string,
  recordCount: number,
  businessDay?: string,
): Promise<void> {
  const projectName = Deno.env.get("PROJECT_NAME") ?? DEFAULT_PROJECT_NAME;
  const resolvedBusinessDay = businessDay ?? toDateString(calcBusinessDay(new Date()));
  await saveRunInSupabase(functionName, projectName, recordCount, resolvedBusinessDay);
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
      const businessDay = getBusinessDay(request);
      await notifyError(functionName, normalizedError, businessDay);
      return new Response(
        JSON.stringify({ error: "Internal Server Error", function_name: functionName }),
        { status: 500, headers: { "Content-Type": JSON_CONTENT_TYPE } },
      );
    }
  };
}
