// lib/nexo-auth.ts
// Autentica as rotas do admin: o front pega o session token com getSessionToken(nexo)
// e manda em "Authorization: Bearer <token>". O token é um JWT HS256 assinado com o CLIENT_SECRET.

import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError, parseId } from "./http";

function base64UrlDecode(part: string): Buffer {
  return Buffer.from(part, "base64url");
}

/**
 * Valida o JWT e devolve o storeId. Retorna null se a assinatura, o algoritmo
 * ou a expiração não baterem. `now` em segundos (para testes).
 */
export function verifySessionToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): number | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !secret) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string };
  let payload: { storeId?: unknown; exp?: unknown; nbf?: unknown };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  // fixa o algoritmo: nunca aceitar "none" ou outro alg escolhido pelo cliente
  if (header?.alg !== "HS256") return null;

  const expected = createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest();
  const received = base64UrlDecode(signatureB64);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  if (!payload || typeof payload !== "object") return null;
  // exp obrigatório: token sem validade nunca expiraria
  if (typeof payload.exp !== "number" || now >= payload.exp) return null;
  if (typeof payload.nbf === "number" && now < payload.nbf) return null;

  return parseId(payload.storeId);
}

/** Lê o Bearer token da requisição e devolve o storeId, ou lança 401. */
export function requireStoreId(req: Request): number {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  const storeId = match ? verifySessionToken(match[1].trim(), process.env.CLIENT_SECRET ?? "") : null;
  if (storeId === null) throw new ApiError("não autorizado", 401);
  return storeId;
}
