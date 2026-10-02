// lib/nuvemshop.ts
// Cliente da API da Nuvemshop para uma loja. O token fica criptografado no banco.

import axios, { type AxiosInstance } from "axios";
import { eq } from "drizzle-orm";
import { stores } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";

export const USER_AGENT = "Atacarejo (suporte@nextcubeinc.com)";

/** Cria um client já apontando para /{storeId}/ — os paths são relativos ("products", "promotions"...). */
export function nuvemshopClient(storeId: number, accessToken: string): AxiosInstance {
  const base = (process.env.NUVEMSHOP_API_URL ?? "").replace(/\/+$/, "");
  const client = axios.create({
    baseURL: `${base}/${storeId}/`,
    timeout: 10_000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
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

  if (!store) throw new ApiError("loja não instalada", 401);
  return nuvemshopClient(storeId, decrypt(store.accessToken));
}
