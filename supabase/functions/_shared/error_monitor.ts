const DISCORD_EMBED_COLOR_ERROR = 15158332; // Rojo

export async function notifyError(functionName: string, error: Error): Promise<void> {
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL no está configurada. No se envió notificación.");
    return;
  }

  const projectName = Deno.env.get("PROJECT_NAME") ?? "Proyecto Desconocido";

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateTime =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const body = {
    embeds: [
      {
        title: "🚨 Error en Edge Function",
        color: DISCORD_EMBED_COLOR_ERROR,
        fields: [
          {
            name: "Proyecto",
            value: projectName,
            inline: true,
          },
          {
            name: "Nombre de la función",
            value: functionName,
            inline: true,
          },
          {
            name: "Mensaje de error",
            value: error.message || String(error),
            inline: false,
          },
          {
            name: "Fecha/Hora",
            value: dateTime,
            inline: true,
          },
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
