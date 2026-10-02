// app/api/auth/callback/auth.service.ts
import axios, { type AxiosInstance } from "axios";
import { storeConfig, stores } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ApiError, parseId } from "@/lib/http";
import { nuvemshopClient, USER_AGENT } from "@/lib/nuvemshop";
import { getStoreConfig } from "@/lib/store-config";
import { eq } from "drizzle-orm";

type TokenResponse = {
  access_token: string;
  token_type: "bearer";
  scope: string;
  user_id: string | number;
};

type SetupStep = "promotion" | "discountCallback" | "uninstallWebhook";
export type SetupResult = Record<SetupStep, { ok: boolean; error?: string }>;

function appUrl(path: string): string {
  return `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}${path}`;
}

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) return `HTTP ${err.response?.status ?? "?"}`;
  return err instanceof Error ? err.message : String(err);
}

export class AuthService {
  /** Troca o code pelo token, salva a loja e configura promoção, callback e webhook. */
  async install(code: string): Promise<{ storeId: number; adminUrl: string | null; setup: SetupResult }> {
    if (!code) {
      throw new ApiError("code not found", 400);
    }

    let data: TokenResponse;
    try {
      // axios devolve a resposta inteira; o JSON da Nuvemshop está em .data
      const res = await axios.post<TokenResponse>(
        process.env.NUVEMSHOP_TOKEN_URL!,
        {
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
        },
        { timeout: 10_000, headers: { "User-Agent": USER_AGENT } },
      );
      data = res.data;
    } catch {
      // axios lança erro em qualquer status fora de 2xx (ex.: code expirado ou já usado)
      throw new ApiError("falha ao trocar code por token", 502);
    }

    const storeId = parseId(data?.user_id);
    if (!data?.access_token || storeId === null) {
      throw new ApiError("token not found", 502);
    }

    const accessToken = encrypt(data.access_token);

    await db
      .insert(stores)
      .values({ storeId, accessToken, scope: data.scope ?? "" })
      .onConflictDoUpdate({
        target: stores.storeId,
        set: { accessToken, scope: data.scope ?? "" },
      });

    await db.insert(storeConfig).values({ storeId }).onConflictDoNothing();

    const api = nuvemshopClient(storeId, data.access_token);
    const setup = await this.setup(storeId, api);

    return { storeId, adminUrl: await this.adminUrl(api), setup };
  }

  /** Cada passo é independente: a falha de um não impede os outros. */
  async setup(storeId: number, api: AxiosInstance): Promise<SetupResult> {
    const run = async (step: () => Promise<void>) => {
      try {
        await step();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    };

    const result: SetupResult = {
      promotion: await run(() => this.ensurePromotion(storeId, api)),
      discountCallback: await run(() => this.registerDiscountCallback(api)),
      uninstallWebhook: await run(() => this.ensureUninstallWebhook(api)),
    };

    for (const [step, r] of Object.entries(result)) {
      if (!r.ok) console.error(`[install] loja ${storeId}: ${step} falhou (${r.error})`);
    }
    return result;
  }

  /**
   * Reaproveita a promoção salva se ela ainda existir na Nuvemshop; senão cria outra.
   * (A Nuvemshop apaga as promoções do app na desinstalação — se o webhook se perder, o id fica morto.)
   */
  async ensurePromotion(storeId: number, api: AxiosInstance): Promise<void> {
    const config = await getStoreConfig(storeId);
    if (config?.promotionId) {
      try {
        await api.get(`promotions/${config.promotionId}`);
        return;
      } catch (err) {
        if (!(axios.isAxiosError(err) && err.response?.status === 404)) throw err;
      }
    }

    const res = await api.post("promotions", {
      name: "Atacado",
      allocation_type: "cross_items",
      active: true,
    });
    const id = res.data?.data?.id ?? res.data?.id;
    if (id == null) throw new Error("resposta sem id da promoção");

    await db
      .update(storeConfig)
      .set({ promotionId: String(id) })
      .where(eq(storeConfig.storeId, storeId));
  }

  async registerDiscountCallback(api: AxiosInstance): Promise<void> {
    await api.put("discounts/callbacks", { url: appUrl("/api/callbacks/discounts") });
  }

  /** Cria o webhook app/uninstalled só se ainda não existir (evita duplicar a cada reinstalação). */
  async ensureUninstallWebhook(api: AxiosInstance): Promise<void> {
    const url = appUrl("/api/webhooks/app-uninstalled");
    const { data: hooks } = await api.get<{ event: string; url: string }[]>("webhooks");
    if (Array.isArray(hooks) && hooks.some((h) => h.event === "app/uninstalled" && h.url === url)) return;
    await api.post("webhooks", { event: "app/uninstalled", url });
  }

  /** URL do app dentro do admin da loja. null se não der para descobrir o domínio. */
  async adminUrl(api: AxiosInstance): Promise<string | null> {
    try {
      const { data } = await api.get<{ original_domain?: string }>("store", {
        params: { fields: "original_domain" },
      });
      if (!data?.original_domain) return null;
      return `https://${data.original_domain}/admin/apps/${process.env.CLIENT_ID}`;
    } catch {
      return null;
    }
  }
}

export const authService = new AuthService();
