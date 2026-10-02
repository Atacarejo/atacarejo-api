// app/api/wholesale/wholesale.service.ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { wholesalePrices } from "@/db/schema";
import { db } from "@/lib/db";
import { ApiError, parseId } from "@/lib/http";
import { fromCents, toCents } from "@/lib/wholesale/money";

export const MAX_ITEMS = 1000;

export type WholesaleDTO = { productId: number; variantId: number; price: string };

export type WholesaleChange =
  | { type: "upsert"; productId: number; variantId: number; price: string }
  | { type: "delete"; variantId: number };

/**
 * Valida o body do POST. Preço vazio, null ou 0 = remover o atacado da variante.
 * Aceita "10,50" e "10.50". Qualquer item inválido → 400 com o índice dele.
 */
export function parseWholesaleItems(body: unknown): WholesaleChange[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) throw new ApiError("items deve ser uma lista", 400);
  if (items.length > MAX_ITEMS) throw new ApiError(`máximo de ${MAX_ITEMS} itens por vez`, 400);

  const seen = new Set<number>();
  return items.map((raw, i) => {
    const item = raw as { productId?: unknown; variantId?: unknown; price?: unknown };
    const productId = parseId(item?.productId);
    const variantId = parseId(item?.variantId);
    if (productId === null || variantId === null) throw new ApiError(`item ${i}: productId/variantId inválido`, 400);
    if (seen.has(variantId)) throw new ApiError(`item ${i}: variante repetida`, 400);
    seen.add(variantId);

    // price ausente é erro (evita apagar dados por campo com nome errado); null ou "" remove
    if (!("price" in Object(item))) throw new ApiError(`item ${i}: price é obrigatório (null para remover)`, 400);
    const empty = item.price === null || (typeof item.price === "string" && item.price.trim() === "");
    if (empty) return { type: "delete", variantId };

    const cents = toCents(item.price);
    if (cents === null) throw new ApiError(`item ${i}: preço inválido`, 400);
    if (cents === 0) return { type: "delete", variantId };

    return { type: "upsert", productId, variantId, price: fromCents(cents) };
  });
}

export async function listWholesale(storeId: number, variantIds: number[] | null): Promise<WholesaleDTO[]> {
  const where = variantIds
    ? and(eq(wholesalePrices.storeId, storeId), inArray(wholesalePrices.variantId, variantIds))
    : eq(wholesalePrices.storeId, storeId);

  return db
    .select({ productId: wholesalePrices.productId, variantId: wholesalePrices.variantId, price: wholesalePrices.price })
    .from(wholesalePrices)
    .where(where);
}

/** Aplica tudo numa transação (batch do neon-http): ou salva tudo, ou nada. */
export async function saveWholesale(storeId: number, changes: WholesaleChange[]) {
  const upserts = changes.filter((c) => c.type === "upsert");
  const deletes = changes.filter((c) => c.type === "delete").map((c) => c.variantId);

  const queries = [];
  if (upserts.length) {
    queries.push(
      db
        .insert(wholesalePrices)
        .values(upserts.map((u) => ({ storeId, productId: u.productId, variantId: u.variantId, price: u.price })))
        .onConflictDoUpdate({
          target: [wholesalePrices.storeId, wholesalePrices.variantId],
          set: { price: sqlExcluded("price"), productId: sqlExcluded("product_id") },
        }),
    );
  }
  if (deletes.length) {
    queries.push(
      db
        .delete(wholesalePrices)
        .where(and(eq(wholesalePrices.storeId, storeId), inArray(wholesalePrices.variantId, deletes))),
    );
  }

  if (queries.length) await db.batch(queries as [(typeof queries)[0], ...typeof queries]);
  return { saved: upserts.length, removed: deletes.length };
}

/** Valor que tentou ser inserido (para o ON CONFLICT DO UPDATE). */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
