// app/api/config/route.ts
import { eq } from "drizzle-orm";
import { storeConfig, stores, wholesalePrices } from "@/db/schema";
import { db } from "@/lib/db";
import { ApiError, readJson, withErrors } from "@/lib/http";
import { requireStoreId } from "@/lib/nexo-auth";
import { DEFAULT_CONFIG, getStoreConfig } from "@/lib/store-config";
import { parseConfigUpdate } from "./config.service";

export const GET = withErrors(async (req) => {
  const storeId = requireStoreId(req);
  const [config, anyPrice] = await Promise.all([
    getStoreConfig(storeId),
    db.select({ id: wholesalePrices.variantId }).from(wholesalePrices).where(eq(wholesalePrices.storeId, storeId)).limit(1),
  ]);
  const { promotionId, minQuantity, atcStoreType, designOption } = config ?? DEFAULT_CONFIG;

  return Response.json({
    minQuantity,
    atcStoreType,
    designOption,
    // ready: false = a promoção não foi criada no install; o admin oferece "Concluir configuração"
    ready: Boolean(promotionId),
    // false = loja ainda não definiu nenhum preço (estado inicial no admin)
    hasWholesalePrices: anyPrice.length > 0,
  });
});

export const PUT = withErrors(async (req) => {
  const storeId = requireStoreId(req);
  const update = parseConfigUpdate(await readJson(req));

  const [store] = await db.select({ id: stores.storeId }).from(stores).where(eq(stores.storeId, storeId)).limit(1);
  if (!store) throw new ApiError("loja não instalada", 401);

  const [row] = await db
    .insert(storeConfig)
    .values({ storeId, ...update })
    .onConflictDoUpdate({ target: storeConfig.storeId, set: update })
    .returning({
      minQuantity: storeConfig.minQuantity,
      atcStoreType: storeConfig.atcStoreType,
      designOption: storeConfig.designOption,
    });

  return Response.json(row);
});
