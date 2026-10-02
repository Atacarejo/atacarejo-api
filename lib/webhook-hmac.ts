// lib/webhook-hmac.ts
// A Nuvemshop assina os webhooks com HMAC-SHA256 do body cru usando o CLIENT_SECRET,
// enviado em hex no header "x-linkedstore-hmac-sha256".

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
