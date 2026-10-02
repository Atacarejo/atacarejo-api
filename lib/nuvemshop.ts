// lib/nuvemshop.ts
// Cliente da API da Nuvemshop para uma loja. O token fica criptografado no banco.

import axios, { type AxiosInstance } from "axios";
import { eq } from "drizzle-orm";
import { stores } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";

const APP_NAME = "Atacarejo";
const SUPPORT_EMAIL = "suporte@nextcubeinc.com";

/**
 * User-Agent exigido pela Nuvemshop em toda chamada: nome do app + app id + e-mail de contato.
 * Ex.: "Atacarejo/1234 (suporte@nextcubeinc.com)". Sem CLIENT_ID (ou com valor estranho,
 * que quebraria o header), fica só o nome. Lido a cada chamada para refletir o env atual.
 */
export function userAgent(): string {
  const appId = (process.env.CLIENT_ID ?? "").trim();
  return /^[\w.-]+$/.test(appId) ? `${APP_NAME}/${appId} (${SUPPORT_EMAIL})` : `${APP_NAME} (${SUPPORT_EMAIL})`;
}

/** Cria um client já apontando para /{storeId}/ — os paths são relativos ("products", "promotions"...). */
export function nuvemshopClient(storeId: number, accessToken: string): AxiosInstance {
  const base = (process.env.NUVEMSHOP_API_URL ?? "").replace(/\/+$/, "");
  const client = axios.create({
    baseURL: `${base}/${storeId}/`,
    timeout: 10_000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": userAgent(),
      "Content-Type": "application/json",
    },
  });
  retryOnRateLimit(client);
  return client;
}

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 2_000;

/** 429 (rate limit da Nuvemshop): espera o reset informado pela API e tenta de novo. */
function retryOnRateLimit(client: AxiosInstance) {
  client.interceptors.response.use(undefined, async (err) => {
    const config = err?.config as (typeof err.config & { __retries?: number }) | undefined;
    if (!axios.isAxiosError(err) || err.response?.status !== 429 || !config) throw err;

    config.__retries = (config.__retries ?? 0) + 1;
    if (config.__retries > MAX_RETRIES) throw err;

    // x-rate-limit-reset: ms até liberar o próximo request
    const reset = Number(err.response.headers["x-rate-limit-reset"]);
    const wait = Math.min(MAX_WAIT_MS, Number.isFinite(reset) && reset > 0 ? reset : 500 * config.__retries);
    await new Promise((r) => setTimeout(r, wait));
    return client.request(config);
  });
}

/** Busca o token da loja no banco e devolve o client. Loja sem token → 401. */
export async function nuvemshopClientFor(storeId: number): Promise<AxiosInstance> {
  const [store] = await db
    .select({ accessToken: stores.accessToken })
    .from(stores)
    .where(eq(stores.storeId, storeId))
    .limit(1);

  if (!store) throw new ApiError("loja não instalada", 401, "store_not_installed");
  return nuvemshopClient(storeId, decrypt(store.accessToken));
}

/**
 * Converte a falha de uma chamada à Nuvemshop em ApiError para o admin:
 * 429 → rate_limited, 401 → invalid_token, qualquer outra (5xx, rede, timeout) → 502.
 * O 429 só chega aqui depois dos retries do client.
 */
export function nuvemshopApiError(err: unknown, fallbackMessage: string): ApiError {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined;
  if (status === 429) {
    return new ApiError("muitas requisições à Nuvemshop, tente de novo em instantes", 429, "rate_limited");
  }
  if (status === 401) return new ApiError("token da loja inválido, reinstale o app", 401, "invalid_token");
  return new ApiError(fallbackMessage, 502, "nuvemshop_unavailable");
}
