import { withErrorMonitoring } from "../_shared/error_monitor.ts";

Deno.serve(withErrorMonitoring("test-alerta", async (request) => {
  const { pathname, searchParams } = new URL(request.url);
  const allowedPaths = new Set(["/", "/test-alerta", "/functions/v1/test-alerta"]);

  if (!allowedPaths.has(pathname)) {
    return new Response("Not Found", { status: 404 });
  }

  // Dispara error cuando fail=1 para probar alertas.
  if (searchParams.get("fail") === "1") {
    throw new Error("Fallo de prueba para Discord");
  }

  return new Response("Alerta procesada", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}));
