// app/api/webhooks/webhook.service.ts
// Webhooks da Nuvemshop: sempre validar o HMAC antes de qualquer coisa.

import { eq } from "drizzle-orm";
import { stores } from "@/db/schema";
import { db } from "@/lib/db";
import { errorBody, parseId } from "@/lib/http";
import { verifyWebhookSignature } from "@/lib/webhook-hmac";

const SIGNATURE_HEADER = "x-linkedstore-hmac-sha256";

/**
 * Lê o body cru, valida a assinatura e devolve o JSON. Retorna uma Response de erro
 * (401/400) quando não dá para confiar no payload.
 */
export async function readSignedWebhook(req: Request): Promise<{ body: Record<string, unknown> } | { error: Response }> {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get(SIGNATURE_HEADER), process.env.CLIENT_SECRET ?? "")) {
    return { error: Response.json(errorBody("invalid signature", "invalid_signature"), { status: 401 }) };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: Response.json(errorBody("JSON inválido", "invalid_json"), { status: 400 }) };
  }
  return { body: body as Record<string, unknown> };
}

/** Apaga todos os dados da loja. store_config e wholesale_prices saem por cascade. */
export async function deleteStoreData(storeId: unknown): Promise<boolean> {
  const id = parseId(storeId);
  if (id === null) return false;
  await db.delete(stores).where(eq(stores.storeId, id));
  return true;
}
