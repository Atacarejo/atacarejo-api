// app/api/webhooks/app-uninstalled/route.ts
// Remove todos os dados da loja (LGPD / desinstalação).
import { internalError } from "@/lib/http";
import { deleteStoreData, readSignedWebhook } from "../webhook.service";

export async function POST(req: Request) {
  const result = await readSignedWebhook(req);
  if ("error" in result) return result.error;

  try {
    await deleteStoreData(result.body.store_id);
  } catch (err) {
    // 500 faz a Nuvemshop reenviar o webhook
    return internalError(err);
  }
  return Response.json({ ok: true });
}
