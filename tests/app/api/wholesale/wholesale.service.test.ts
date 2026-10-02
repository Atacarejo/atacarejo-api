import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";

vi.mock("@/lib/db", () => ({ db: {} }));

import { MAX_ITEMS, parseWholesaleItems } from "@/app/api/wholesale/wholesale.service";

const item = (over: Record<string, unknown> = {}) => ({ productId: 1, variantId: 10, price: "10,50", ...over });

function apiError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    return err as ApiError;
  }
  throw new Error("deveria ter lançado ApiError 400");
}

describe("parseWholesaleItems — formato do body", () => {
  it.each([null, undefined, {}, [], "items", { items: null }, { items: {} }, { items: "a" }, { items: 1 }])(
    "body %j sem lista em items → 400",
    (body) => {
      expect(apiError(() => parseWholesaleItems(body)).message).toBe("items deve ser uma lista");
    },
  );

  it("lista vazia → []", () => {
    expect(parseWholesaleItems({ items: [] })).toEqual([]);
  });

  it(`exatamente ${MAX_ITEMS} itens é aceito`, () => {
    const items = Array.from({ length: MAX_ITEMS }, (_, i) => item({ variantId: i + 1 }));
    expect(parseWholesaleItems({ items })).toHaveLength(MAX_ITEMS);
  });

  it(`${MAX_ITEMS + 1} itens → 400`, () => {
    const items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item({ variantId: i + 1 }));
    expect(apiError(() => parseWholesaleItems({ items })).message).toMatch(/máximo de 1000/);
  });
});

describe("parseWholesaleItems — preço", () => {
  it.each([
    ["\"10,50\"", "10,50", "10.50"],
    ["\"10.5\"", "10.5", "10.50"],
    ["10.5 (número)", 10.5, "10.50"],
    ["\" 7 \"", " 7 ", "7.00"],
    ["\"0,01\"", "0,01", "0.01"],
  ])("%s → upsert %j", (_l, price, expected) => {
    expect(parseWholesaleItems({ items: [item({ price })] })).toEqual([
      { type: "upsert", productId: 1, variantId: 10, price: expected },
    ]);
  });

  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["null", null],
    ["0", 0],
    ["\"0\"", "0"],
    ["\"0,00\"", "0,00"],
    ["\"0.0\"", "0.0"],
  ])("preço %s → delete", (_l, price) => {
    expect(parseWholesaleItems({ items: [item({ price })] })).toEqual([{ type: "delete", variantId: 10 }]);
  });

  it.each([
    ["negativo", "-1"],
    ["negativo número", -1],
    ["texto", "abc"],
    ["3 casas", "10.555"],
    ["milhar", "1.000,00"],
    ["11 dígitos", "12345678901"],
    ["booleano", true],
    ["objeto", { v: 1 }],
    ["NaN", NaN],
  ])("preço %s → 400 com índice", (_l, price) => {
    const err = apiError(() => parseWholesaleItems({ items: [item({ variantId: 1 }), item({ variantId: 2, price })] }));
    expect(err.message).toBe("item 1: preço inválido");
  });
});

describe("parseWholesaleItems — ids", () => {
  it.each([
    ["productId ausente", { productId: undefined }],
    ["variantId ausente", { variantId: undefined }],
    ["productId 0", { productId: 0 }],
    ["variantId negativo", { variantId: -5 }],
    ["variantId fracionado", { variantId: 1.5 }],
    ["variantId com zero à esquerda", { variantId: "010" }],
    ["variantId texto", { variantId: "abc" }],
    ["variantId inseguro", { variantId: 2 ** 53 }],
  ])("%s → 400 com índice", (_l, over) => {
    const err = apiError(() => parseWholesaleItems({ items: [item({ variantId: 1 }), item({ variantId: 2 }), item(over)] }));
    expect(err.message).toBe("item 2: productId/variantId inválido");
  });

  it("item null → 400 no índice dele", () => {
    expect(apiError(() => parseWholesaleItems({ items: [null] })).message).toBe("item 0: productId/variantId inválido");
  });

  it("ids como string numérica são aceitos", () => {
    expect(parseWholesaleItems({ items: [item({ productId: "1", variantId: "10" })] })).toEqual([
      { type: "upsert", productId: 1, variantId: 10, price: "10.50" },
    ]);
  });

  it("variantId repetido → 400 com o índice da repetição", () => {
    const err = apiError(() =>
      parseWholesaleItems({ items: [item({ variantId: 10 }), item({ variantId: 20 }), item({ variantId: "10", price: "" })] }),
    );
    expect(err.message).toBe("item 2: variante repetida");
  });

  it("validação de id vem antes da de preço (mensagem do id)", () => {
    expect(apiError(() => parseWholesaleItems({ items: [item({ variantId: "x", price: "abc" })] })).message).toBe(
      "item 0: productId/variantId inválido",
    );
  });

  it("mistura upsert e delete preservando a ordem", () => {
    expect(
      parseWholesaleItems({ items: [item({ variantId: 1 }), item({ variantId: 2, price: "" }), item({ variantId: 3, price: 0 })] }),
    ).toEqual([
      { type: "upsert", productId: 1, variantId: 1, price: "10.50" },
      { type: "delete", variantId: 2 },
      { type: "delete", variantId: 3 },
    ]);
  });
});

describe("parseWholesaleItems — price obrigatório", () => {
  it("campo price ausente → 400 (não apaga dados por engano)", () => {
    expect(() => parseWholesaleItems({ items: [{ productId: 1, variantId: 10 }] })).toThrow(/price é obrigatório/);
  });
  it("price undefined → 400", () => {
    expect(() => parseWholesaleItems({ items: [{ productId: 1, variantId: 10, price: undefined }] })).toThrow();
  });
});
