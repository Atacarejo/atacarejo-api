// TEMPORÁRIO: cópia de atacarejo-db/src/schema.ts até o banco dev ser resetado.
// Depois do migrate, rode `yarn db:pull` — este arquivo é sobrescrito pelo drizzle-kit.

import {
  bigint,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// IDs da Nuvemshop são numéricos. mode "number" é seguro: os IDs cabem em Number.MAX_SAFE_INTEGER.
const nuvemshopId = (name: string) => bigint(name, { mode: "number" });

export const stores = pgTable("stores", {
  storeId: nuvemshopId("store_id").primaryKey(),
  // criptografado (AES-256-GCM) pela API antes de salvar
  accessToken: text("access_token").notNull(),
  scope: text("scope").notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow().notNull(),
});

// Modo de atacado da loja. Hoje só "all" está implementado:
// all     → o mínimo vale para a soma das unidades com preço de atacado no carrinho
// product → (futuro) mínimo por produto
// mixed   → (futuro) combinação dos dois
export const atcStoreType = pgEnum("atc_store_type", ["all", "product", "mixed"]);

export const storeConfig = pgTable("store_config", {
  storeId: nuvemshopId("store_id")
    .primaryKey()
    .references(() => stores.storeId, { onDelete: "cascade" }),
  // id da promoção "Atacado" (cross_items) criada no install; null até ser criada
  promotionId: text("promotion_id"),
  minQuantity: integer("min_quantity").default(3).notNull(),
  atcStoreType: atcStoreType("atc_store_type").default("all").notNull(),
  designOption: integer("design_option").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// Só as exceções: uma linha por variante que tem preço de atacado
export const wholesalePrices = pgTable(
  "wholesale_prices",
  {
    storeId: nuvemshopId("store_id")
      .notNull()
      .references(() => stores.storeId, { onDelete: "cascade" }),
    productId: nuvemshopId("product_id").notNull(),
    variantId: nuvemshopId("variant_id").notNull(),
    // numeric vira string no TypeScript; no banco mantém precisão de dinheiro
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.variantId] })],
);
