// app/api/callbacks/discounts/discount.service.ts
// A Nuvemshop chama o callback a cada mudança no carrinho e espera resposta em < 800 ms.
// Regra: nunca travar o checkout — qualquer erro vira 204 (sem mudança).

import { and, eq, inArray } from "drizzle-orm";
import { wholesalePrices } from "@/db/schema";
import { db } from "@/lib/db";
import { parseId } from "@/lib/http";
import { isLocale, WHOLESALE_LABEL } from "@/lib/locale";
import { getStoreConfig, type StoreConfig } from "@/lib/store-config";
import { computeWholesaleDiscountCents } from "@/lib/wholesale/discount";
import type { CartItem } from "@/lib/wholesale/eligibility";
import { fromCents, toCents } from "@/lib/wholesale/money";

export type DiscountCallbackPayload = {
  store_id?: unknown;
  currency?: unknown;
  execution_tier?: unknown;
  /** idioma do carrinho, ex.: "es" */
  language?: unknown;
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
// Preços de atacado são cadastrados na moeda principal da loja (a Nuvemshop não suporta multimoeda
// em descontos): o desconto vai na moeda do carrinho, que é a da loja.
// 310: app não configurado para a loja → a Nuvemshop remove os descontos do app
const NOT_CONFIGURED: CallbackResult = { status: 310, body: null };

// texto do desconto no carrinho/checkout: a chave é o idioma, como "es-ar" na doc da Nuvemshop.
// Manda as variantes das lojas atendidas para a Nuvemshop escolher a do idioma da loja.
const DISPLAY_TEXT: Record<string, string> = {
  "pt-br": WHOLESALE_LABEL.pt,
  "es-ar": WHOLESALE_LABEL.es,
  "es-mx": WHOLESALE_LABEL.es,
  "en-us": WHOLESALE_LABEL.en,
};

/** DISPLAY_TEXT + a chave do idioma do carrinho ("es", "pt_BR" → "pt-br"), se for um idioma suportado. */
export function displayText(language: unknown): Record<string, string> {
  const text = { ...DISPLAY_TEXT };
  const key = typeof language === "string" ? language.trim().toLowerCase().replace("_", "-") : "";
  const prefix = key.split("-")[0];
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(key) && isLocale(prefix)) text[key] ??= WHOLESALE_LABEL[prefix];
  return text;
}

/** Moeda do carrinho: código ISO 4217 ("BRL", "ARS", "CLP"...). Qualquer outra coisa → null. */
export function parseCurrency(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

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

  // sem moeda válida não dá para montar o comando: não adivinha, deixa o carrinho como está
  const currency = parseCurrency(payload.currency);
  if (currency === null) return NO_CHANGE;

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
            currency,
            display_text: displayText(payload.language),
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
