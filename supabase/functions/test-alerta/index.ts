import { getBusinessDay, withErrorMonitoring } from "../_shared/error_monitor.ts";

Deno.serve(withErrorMonitoring("test-alerta", async (request) => {
  const { pathname, searchParams } = new URL(request.url);
  const allowedPaths = new Set(["/", "/test-alerta", "/functions/v1/test-alerta"]);

  if (!allowedPaths.has(pathname)) {
    return new Response("Not Found", { status: 404 });
  }

  // Fecha de negocio: viene del header X-Business-Day en retries, o es ayer por defecto
  const businessDay = getBusinessDay(request);

  // Dispara error cuando fail=1 para probar alertas.
  if (searchParams.get("fail") === "1") {
    throw new Error(`Fallo de prueba para Discord (businessDay: ${businessDay})`);
  }

  return new Response(
    JSON.stringify({ message: "Alerta procesada", business_day: businessDay }),
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}));
