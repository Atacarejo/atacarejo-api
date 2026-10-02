import { describe, expect, it } from "vitest";
import { isWholesaleCart, wholesaleItems, type AtcStoreType, type CartItem, type WholesaleRule } from "@/lib/wholesale/eligibility";

const rule = (prices: [number, number][], minQuantity = 3, mode: AtcStoreType = "all"): WholesaleRule => ({
  mode,
  minQuantity,
  wholesalePriceCents: new Map(prices),
});

const item = (variantId: number, quantity: number, priceCents = 1000): CartItem => ({ variantId, quantity, priceCents });

describe("wholesaleItems", () => {
  it("só devolve itens cuja variante tem preço de atacado", () => {
    const r = rule([[1, 800]]);
    expect(wholesaleItems(r, [item(1, 2), item(2, 5)])).toEqual([item(1, 2)]);
  });

  it("descarta quantidade 0 e negativa", () => {
    const r = rule([[1, 800]]);
    expect(wholesaleItems(r, [item(1, 0), item(1, -2)])).toEqual([]);
  });
});

describe("isWholesaleCart — modo all", () => {
  it("exatamente no mínimo é atacado", () => {
    expect(isWholesaleCart(rule([[1, 800]], 3), [item(1, 3)])).toBe(true);
  });

  it("mínimo − 1 não é atacado", () => {
    expect(isWholesaleCart(rule([[1, 800]], 3), [item(1, 2)])).toBe(false);
  });

  it("soma unidades de variantes diferentes com atacado", () => {
    expect(isWholesaleCart(rule([[1, 800], [2, 500]], 3), [item(1, 1), item(2, 2)])).toBe(true);
  });

  it("itens sem preço de atacado não contam para o mínimo", () => {
    // 2 unidades com atacado + 10 sem → continua abaixo do mínimo 3
    expect(isWholesaleCart(rule([[1, 800]], 3), [item(1, 2), item(2, 10)])).toBe(false);
  });

  it("linhas duplicadas da mesma variante somam as quantidades", () => {
    expect(isWholesaleCart(rule([[1, 800]], 3), [item(1, 1), item(1, 2)])).toBe(true);
  });

  it("quantidade 0 não conta", () => {
    expect(isWholesaleCart(rule([[1, 800]], 1), [item(1, 0)])).toBe(false);
  });

  it("quantidade negativa não abate unidades das outras linhas", () => {
    expect(isWholesaleCart(rule([[1, 800]], 3), [item(1, 3), item(1, -5)])).toBe(true);
  });

  it("carrinho vazio nunca é atacado, mesmo com mínimo 0", () => {
    expect(isWholesaleCart(rule([[1, 800]], 0), [])).toBe(false);
  });

  it("mapa de preços vazio nunca é atacado", () => {
    expect(isWholesaleCart(rule([], 1), [item(1, 100)])).toBe(false);
  });

  it("mínimo 1 com uma unidade é atacado", () => {
    expect(isWholesaleCart(rule([[1, 800]], 1), [item(1, 1)])).toBe(true);
  });
});

describe("isWholesaleCart — modos rascunho (product/mixed)", () => {
  it.each<AtcStoreType>(["product", "mixed"])("%s se comporta como all", (mode) => {
    const cases: CartItem[][] = [[item(1, 3)], [item(1, 2)], [item(1, 2), item(2, 10)], []];
    for (const cart of cases) {
      expect(isWholesaleCart(rule([[1, 800]], 3, mode), cart)).toBe(isWholesaleCart(rule([[1, 800]], 3, "all"), cart));
    }
  });

  it("modo desconhecido (valor fora do enum vindo do banco) lança erro", () => {
    const r = { ...rule([[1, 800]]), mode: "xpto" as AtcStoreType };
    expect(() => isWholesaleCart(r, [item(1, 3)])).toThrow(/modo de atacado desconhecido/);
  });
});
