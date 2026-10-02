// lib/store-config.ts
// Leitura da configuração da loja com os padrões aplicados (loja sem linha em store_config
// se comporta como os defaults do banco).

import { eq } from "drizzle-orm";
import { storeConfig } from "@/db/schema";
import { db } from "@/lib/db";
import type { AtcStoreType } from "@/lib/wholesale/eligibility";

export const DEFAULT_MIN_QUANTITY = 3;

export type StoreConfig = {
  promotionId: string | null;
  minQuantity: number;
  atcStoreType: AtcStoreType;
  designOption: number;
};

export const DEFAULT_CONFIG: StoreConfig = {
  promotionId: null,
  minQuantity: DEFAULT_MIN_QUANTITY,
  atcStoreType: "all",
  designOption: 1,
};

export async function getStoreConfig(storeId: number): Promise<StoreConfig | null> {
  const [row] = await db
    .select({
      promotionId: storeConfig.promotionId,
      minQuantity: storeConfig.minQuantity,
      atcStoreType: storeConfig.atcStoreType,
      designOption: storeConfig.designOption,
    })
    .from(storeConfig)
    .where(eq(storeConfig.storeId, storeId))
    .limit(1);

  return row ?? null;
}
