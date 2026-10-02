import { relations } from "drizzle-orm/relations";
import { storeConfig, stores, wholesalePrices } from "./schema";

export const storesRelations = relations(stores, ({ one, many }) => ({
  config: one(storeConfig),
  wholesalePrices: many(wholesalePrices),
}));

export const storeConfigRelations = relations(storeConfig, ({ one }) => ({
  store: one(stores, { fields: [storeConfig.storeId], references: [stores.storeId] }),
}));

export const wholesalePricesRelations = relations(wholesalePrices, ({ one }) => ({
  store: one(stores, { fields: [wholesalePrices.storeId], references: [stores.storeId] }),
}));
