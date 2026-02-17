import { notifyError } from "../_shared/error_monitor.ts";

Deno.serve(async (request) => {
  const { pathname } = new URL(request.url);
  const allowedPaths = new Set(["/", "/functions/v1/test-alerta"]);

  if (!allowedPaths.has(pathname)) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    throw new Error("Fallo de prueba para Discord");
  } catch (error) {
    await notifyError("test-alerta", error instanceof Error ? error : new Error(String(error)));
  }
  return new Response("Alerta procesada", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
