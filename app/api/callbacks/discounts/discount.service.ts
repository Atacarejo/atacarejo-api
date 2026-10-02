// app/api/callbacks/discounts/discount.service.ts
// A Nuvemshop chama o callback a cada mudança no carrinho e espera resposta em < 800 ms.
// Regra: nunca travar o checkout — qualquer erro vira 204 (sem mudança).

import { and, eq, inArray } from "drizzle-orm";
import { wholesalePrices } from "@/db/schema";
import { db } from "@/lib/db";
import { parseId } from "@/lib/http";
import { getStoreConfig, type StoreConfig } from "@/lib/store-config";
import { computeWholesaleDiscountCents } from "@/lib/wholesale/discount";
import type { CartItem } from "@/lib/wholesale/eligibility";
import { fromCents, toCents } from "@/lib/wholesale/money";

export type DiscountCallbackPayload = {
  store_id?: unknown;
  currency?: unknown;
  execution_tier?: unknown;
  products?: { variant_id?: unknown; product_id?: unknown; quantity?: unknown; price?: unknown }[];
};

/** status + body (null = sem body) para a rota montar a Response. */
export type CallbackResult = { status: number; body: unknown };

export type DiscountDeps = {
  getConfig: (storeId: number) => Promise<StoreConfig | null>;
  /** variantId → preço de atacado em centavos, só para as variantes pedidas e com preço > 0 */
  getWholesalePrices: (storeId: number, variantIds: number[]) => Promise<Map<number, number>>;
};

const NO_CHANGE: CallbackResult = { status: 204, body: null };
// preços de atacado são cadastrados em BRL; a Nuvemshop não suporta multimoeda em descontos
export const SUPPORTED_CURRENCY = "BRL";
// 310: app não configurado para a loja → a Nuvemshop remove os descontos do app
const NOT_CONFIGURED: CallbackResult = { status: 310, body: null };

function parseQuantity(value: unknown): number {
  if (typeof value === "number") return value;
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
}

/** Preço vindo da Nuvemshop: aceita mais de 2 casas ("10.000") arredondando para centavos. */
function parseCallbackPrice(value: unknown): number | null {
  const strict = toCents(value);
  if (strict !== null) return strict;
  const s = typeof value === "number" ? String(value) : value;
  const match = typeof s === "string" ? /^(\d{1,10})[.,](\d{3,})$/.exec(s.trim()) : null;
  if (!match) return null;
  // arredonda pela 3ª casa em texto (sem erro de ponto flutuante: "1.005" → 101)
  const [, int, dec] = match;
  return Number(int) * 100 + Number(dec.slice(0, 2)) + (dec[2] >= "5" ? 1 : 0);
}

/** Normaliza os produtos do payload. Itens inválidos são ignorados (não contam para o atacado). */
export function parseCart(products: DiscountCallbackPayload["products"]): CartItem[] {
  if (!Array.isArray(products)) return [];
  const cart: CartItem[] = [];
  for (const p of products) {
    const variantId = parseId(p?.variant_id);
    const quantity = parseQuantity(p?.quantity);
    const priceCents = parseCallbackPrice(p?.price);
    if (variantId === null || !Number.isInteger(quantity) || quantity <= 0 || priceCents === null) continue;
    cart.push({ variantId, productId: parseId(p?.product_id) ?? undefined, quantity, priceCents });
  }
  return cart;
}

export async function handleDiscountCallback(
  payload: DiscountCallbackPayload,
  deps: DiscountDeps = defaultDeps,
): Promise<CallbackResult> {
  const storeId = parseId(payload?.store_id);
  if (storeId === null) return NO_CHANGE;

  // nossa promoção é cross_items; outros tiers não são com a gente
  if (payload.execution_tier != null && payload.execution_tier !== "cross_items") return NO_CHANGE;

  // carrinho em outra moeda: não dá para comparar com o preço de atacado em BRL
  if (typeof payload.currency === "string" && payload.currency && payload.currency !== SUPPORTED_CURRENCY) {
    return NO_CHANGE;
  }

  const cart = parseCart(payload.products);
  const variantIds = [...new Set(cart.map((i) => i.variantId))];

  // em paralelo para caber nos 800 ms
  const [config, prices] = await Promise.all([
    deps.getConfig(storeId),
    variantIds.length ? deps.getWholesalePrices(storeId, variantIds) : Promise.resolve(new Map<number, number>()),
  ]);

  if (!config?.promotionId) return NOT_CONFIGURED;

  const discountCents = computeWholesaleDiscountCents(
    { mode: config.atcStoreType, minQuantity: config.minQuantity, wholesalePriceCents: prices },
    cart,
  );

  if (discountCents <= 0) {
    return {
      status: 200,
      body: {
        commands: [{ command: "remove_discount", specs: { scope: "cart", promotion_ids: [config.promotionId] } }],
      },
    };
  }

  return {
    status: 200,
    body: {
      commands: [
        {
          command: "create_or_update_discount",
          specs: {
            promotion_id: config.promotionId,
            currency: SUPPORTED_CURRENCY,
            display_text: { "pt-br": "Atacado" },
            discount_specs: { type: "fixed", amount: fromCents(discountCents) },
          },
        },
      ],
    },
  };
}

const defaultDeps: DiscountDeps = {
  getConfig: getStoreConfig,
  async getWholesalePrices(storeId, variantIds) {
    const rows = await db
      .select({ variantId: wholesalePrices.variantId, price: wholesalePrices.price })
      .from(wholesalePrices)
      .where(and(eq(wholesalePrices.storeId, storeId), inArray(wholesalePrices.variantId, variantIds)));

    const map = new Map<number, number>();
    for (const r of rows) {
      const cents = toCents(r.price);
      // 0 = sem atacado
      if (cents !== null && cents > 0) map.set(r.variantId, cents);
    }
    return map;
  },
};
