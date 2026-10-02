// lib/wholesale/eligibility.ts
// ÚNICO lugar que decide "este carrinho é atacado?". O desconto (e, no futuro,
// as Business Rules de frete/pagamento) usam esta função — não duplique a regra.

export type AtcStoreType = "all" | "product" | "mixed";

export type CartItem = {
  variantId: number;
  productId?: number;
  quantity: number;
  /** preço unitário normal, em centavos */
  priceCents: number;
};

export type WholesaleRule = {
  mode: AtcStoreType;
  minQuantity: number;
  /** variantId → preço de atacado em centavos (só variantes com atacado > 0) */
  wholesalePriceCents: Map<number, number>;
};

/** Itens do carrinho que têm preço de atacado configurado. */
export function wholesaleItems(rule: WholesaleRule, cart: CartItem[]): CartItem[] {
  return cart.filter((item) => rule.wholesalePriceCents.has(item.variantId) && item.quantity > 0);
}

/** Modo "all": soma as unidades de TODOS os itens com atacado e compara com o mínimo da loja. */
function isWholesaleAll(rule: WholesaleRule, cart: CartItem[]): boolean {
  const units = wholesaleItems(rule, cart).reduce((sum, item) => sum + item.quantity, 0);
  return units > 0 && units >= rule.minQuantity;
}

export function isWholesaleCart(rule: WholesaleRule, cart: CartItem[]): boolean {
  switch (rule.mode) {
    case "all":
      return isWholesaleAll(rule, cart);

    case "product":
      // RASCUNHO: atacado por produto (ex.: mínimo de unidades do MESMO produto).
      // Regra ainda não definida — até lá, mesmo comportamento do "all".
      return isWholesaleAll(rule, cart);

    case "mixed":
      // RASCUNHO: combinação de "all" e "product". Regra ainda não definida.
      return isWholesaleAll(rule, cart);

    default: {
      const exhaustive: never = rule.mode;
      throw new Error(`modo de atacado desconhecido: ${String(exhaustive)}`);
    }
  }
}
