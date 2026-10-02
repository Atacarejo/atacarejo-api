import { describe, expect, it } from "vitest";
import { computeWholesaleDiscountCents } from "@/lib/wholesale/discount";
import type { AtcStoreType, CartItem, WholesaleRule } from "@/lib/wholesale/eligibility";

const rule = (prices: [number, number][], minQuantity = 3, mode: AtcStoreType = "all"): WholesaleRule => ({
  mode,
  minQuantity,
  wholesalePriceCents: new Map(prices),
});

const item = (variantId: number, quantity: number, priceCents: number): CartItem => ({ variantId, quantity, priceCents });

describe("computeWholesaleDiscountCents", () => {
  it("soma (normal − atacado) × quantidade no mínimo exato", () => {
    // (1000 − 800) × 3 = 600
    expect(computeWholesaleDiscountCents(rule([[1, 800]], 3), [item(1, 3, 1000)])).toBe(600);
  });

  it("abaixo do mínimo → 0", () => {
    expect(computeWholesaleDiscountCents(rule([[1, 800]], 3), [item(1, 2, 1000)])).toBe(0);
  });

  it("itens sem atacado não recebem desconto nem contam para o mínimo", () => {
    const cart = [item(1, 3, 1000), item(2, 5, 2000)];
    expect(computeWholesaleDiscountCents(rule([[1, 800]], 3), cart)).toBe(600);
  });

  it("itens sem atacado não completam o mínimo", () => {
    const cart = [item(1, 2, 1000), item(2, 5, 2000)];
    expect(computeWholesaleDiscountCents(rule([[1, 800]], 3), cart)).toBe(0);
  });

  it("atacado MAIOR que o normal conta 0 para o item e não reduz o desconto dos outros", () => {
    const cart = [item(1, 2, 1000), item(2, 2, 500)];
    // variante 1: (1000 − 800) × 2 = 400; variante 2: atacado 900 > 500 → 0 (e não −800)
    expect(computeWholesaleDiscountCents(rule([[1, 800], [2, 900]], 3), cart)).toBe(400);
  });

  it("atacado maior que o normal ainda conta unidades para o mínimo", () => {
    const cart = [item(1, 1, 1000), item(2, 2, 500)];
    expect(computeWholesaleDiscountCents(rule([[1, 800], [2, 900]], 3), cart)).toBe(200);
  });

  it("atacado igual ao normal → 0", () => {
    expect(computeWholesaleDiscountCents(rule([[1, 1000]], 1), [item(1, 5, 1000)])).toBe(0);
  });

  it("linhas duplicadas da mesma variante: cada linha soma o próprio desconto", () => {
    const cart = [item(1, 1, 1000), item(1, 2, 1000)];
    expect(computeWholesaleDiscountCents(rule([[1, 800]], 3), cart)).toBe(600);
  });

  it("linhas duplicadas com preços normais diferentes usam o preço de cada linha", () => {
    const cart = [item(1, 2, 1000), item(1, 1, 1200)];
    // 2 × 200 + 1 × 400
    expect(computeWholesaleDiscountCents(rule([[1, 800]], 3), cart)).toBe(800);
  });

  it("linha com quantidade 0 não soma desconto", () => {
    const cart = [item(1, 3, 1000), item(2, 0, 5000)];
    expect(computeWholesaleDiscountCents(rule([[1, 800], [2, 100]], 3), cart)).toBe(600);
  });

  it("carrinho vazio → 0", () => {
    expect(computeWholesaleDiscountCents(rule([[1, 800]], 0), [])).toBe(0);
  });

  it("mapa de preços vazio → 0", () => {
    expect(computeWholesaleDiscountCents(rule([], 1), [item(1, 10, 1000)])).toBe(0);
  });

  it("resultado é inteiro em centavos (sem erro de float)", () => {
    const cart = [item(1, 3, 1010), item(2, 7, 333)];
    const d = computeWholesaleDiscountCents(rule([[1, 999], [2, 111]], 3), cart);
    expect(d).toBe(3 * 11 + 7 * 222);
    expect(Number.isInteger(d)).toBe(true);
  });

  it.each<AtcStoreType>(["product", "mixed"])("modo %s calcula igual ao all", (mode) => {
    const cart = [item(1, 2, 1000), item(2, 1, 2000), item(3, 4, 300)];
    const prices: [number, number][] = [[1, 800], [2, 1500]];
    expect(computeWholesaleDiscountCents(rule(prices, 3, mode), cart)).toBe(
      computeWholesaleDiscountCents(rule(prices, 3, "all"), cart),
    );
  });
});
