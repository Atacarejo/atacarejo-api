// lib/wholesale/discount.ts
// Cálculo do desconto de atacado (puro, sem banco — fácil de testar).

import { isWholesaleCart, wholesaleItems, type CartItem, type WholesaleRule } from "./eligibility";

/**
 * Desconto total em centavos: soma de (preço normal − preço de atacado) × quantidade
 * dos itens com atacado. Retorna 0 se o carrinho não for atacado.
 * Item com atacado MAIOR que o preço normal conta como 0 (não reduz o desconto dos outros).
 */
export function computeWholesaleDiscountCents(rule: WholesaleRule, cart: CartItem[]): number {
  if (!isWholesaleCart(rule, cart)) return 0;

  return wholesaleItems(rule, cart).reduce((sum, item) => {
    const wholesale = rule.wholesalePriceCents.get(item.variantId)!;
    const perUnit = Math.max(0, item.priceCents - wholesale);
    return sum + perUnit * item.quantity;
  }, 0);
}
