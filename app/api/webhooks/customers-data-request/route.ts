// app/api/webhooks/customers-data-request/route.ts
// O app não guarda dados de clientes da loja: só confirma o recebimento.
import { readSignedWebhook } from "../webhook.service";

export async function POST(req: Request) {
  const result = await readSignedWebhook(req);
  if ("error" in result) return result.error;
  return Response.json({ ok: true });
}
