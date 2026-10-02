import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreConfig } from "@/lib/store-config";

// o service importa @/lib/db (neon) no topo — nunca deixar conectar
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  displayText,
  handleDiscountCallback,
  parseCart,
  parseCurrency,
  type DiscountCallbackPayload,
  type DiscountDeps,
} from "@/app/api/callbacks/discounts/discount.service";

const CONFIG: StoreConfig = { promotionId: "promo-1", minQuantity: 3, atcStoreType: "all", designOption: 1 };

function deps(opts: { config?: StoreConfig | null; prices?: [number, number][] } = {}) {
  const config = "config" in opts ? opts.config! : CONFIG;
  return {
    getConfig: vi.fn<DiscountDeps["getConfig"]>(async () => config),
    getWholesalePrices: vi.fn<DiscountDeps["getWholesalePrices"]>(async () => new Map(opts.prices ?? [[10, 800]])),
  };
}

const payload = (over: Partial<DiscountCallbackPayload> = {}): DiscountCallbackPayload => ({
  store_id: 123,
  currency: "BRL",
  execution_tier: "cross_items",
  products: [{ variant_id: 10, product_id: 1, quantity: 3, price: "10.00" }],
  ...over,
});

describe("handleDiscountCallback — guardas que devolvem 204", () => {
  it.each([undefined, null, "", "abc", 0, -1, "0", 1.5, "1e3", "007", {}, []])("store_id inválido %j → 204 sem consultar nada", async (store_id) => {
    const d = deps();
    const r = await handleDiscountCallback(payload({ store_id }), d);
    expect(r).toEqual({ status: 204, body: null });
    expect(d.getConfig).not.toHaveBeenCalled();
    expect(d.getWholesalePrices).not.toHaveBeenCalled();
  });

  it("payload null → 204", async () => {
    const r = await handleDiscountCallback(null as unknown as DiscountCallbackPayload, deps());
    expect(r.status).toBe(204);
  });

  it.each(["line_items", "CROSS_ITEMS", "", 0, false])("execution_tier %j → 204", async (execution_tier) => {
    const d = deps();
    const r = await handleDiscountCallback(payload({ execution_tier }), d);
    expect(r).toEqual({ status: 204, body: null });
    expect(d.getConfig).not.toHaveBeenCalled();
  });

  it.each([undefined, null])("execution_tier ausente (%j) é tratado como cross_items", async (execution_tier) => {
    const r = await handleDiscountCallback(payload({ execution_tier }), deps());
    expect(r.status).toBe(200);
  });

  it("store_id como string numérica é aceito", async () => {
    const d = deps();
    await handleDiscountCallback(payload({ store_id: "123" }), d);
    expect(d.getConfig).toHaveBeenCalledWith(123);
  });
});

describe("handleDiscountCallback — loja não configurada → 310", () => {
  it("config null → 310", async () => {
    const r = await handleDiscountCallback(payload(), deps({ config: null }));
    expect(r).toEqual({ status: 310, body: null });
  });

  it.each([null, ""])("promotionId %j → 310", async (promotionId) => {
    const r = await handleDiscountCallback(payload(), deps({ config: { ...CONFIG, promotionId } }));
    expect(r).toEqual({ status: 310, body: null });
  });

  it("310 mesmo com carrinho vazio", async () => {
    const r = await handleDiscountCallback(payload({ products: [] }), deps({ config: null }));
    expect(r.status).toBe(310);
  });
});

describe("handleDiscountCallback — comandos para a Nuvemshop", () => {
  it("abaixo do mínimo → remove_discount com o id da promoção", async () => {
    const r = await handleDiscountCallback(
      payload({ products: [{ variant_id: 10, quantity: 2, price: "10.00" }] }),
      deps(),
    );
    expect(r).toEqual({
      status: 200,
      body: { commands: [{ command: "remove_discount", specs: { scope: "cart", promotion_ids: ["promo-1"] } }] },
    });
  });

  it("carrinho vazio → remove_discount e não consulta preços", async () => {
    const d = deps();
    const r = await handleDiscountCallback(payload({ products: [] }), d);
    expect(r.body).toEqual({ commands: [{ command: "remove_discount", specs: { scope: "cart", promotion_ids: ["promo-1"] } }] });
    expect(d.getWholesalePrices).not.toHaveBeenCalled();
  });

  it("desconto 0 (atacado ≥ normal) → remove_discount", async () => {
    const r = await handleDiscountCallback(payload(), deps({ prices: [[10, 1000]] }));
    expect((r.body as { commands: { command: string }[] }).commands[0].command).toBe("remove_discount");
  });

  it("no mínimo → create_or_update_discount com formato exato", async () => {
    // (12.10 − 8.00) × 3 = 12.30
    const r = await handleDiscountCallback(
      payload({ products: [{ variant_id: 10, product_id: 1, quantity: 3, price: "12.10" }] }),
      deps(),
    );
    expect(r).toEqual({
      status: 200,
      body: {
        commands: [
          {
            command: "create_or_update_discount",
            specs: {
              promotion_id: "promo-1",
              currency: "BRL",
              display_text: { "pt-br": "Atacado", "es-ar": "Mayorista", "es-mx": "Mayorista", "en-us": "Wholesale" },
              discount_specs: { type: "fixed", amount: "12.30" },
            },
          },
        ],
      },
    });
  });

  it("amount é string com 2 casas mesmo para valor inteiro e centavo único", async () => {
    const amount = async (price: string, wholesale: number, quantity: number) => {
      const r = await handleDiscountCallback(
        payload({ products: [{ variant_id: 10, quantity, price }] }),
        deps({ prices: [[10, wholesale]] }),
      );
      return (r.body as { commands: { specs: { discount_specs: { amount: string } } }[] }).commands[0].specs.discount_specs.amount;
    };
    expect(await amount("10.00", 900, 3)).toBe("3.00");
    expect(await amount("0.10", 9, 3)).toBe("0.03");
    expect(await amount("0,30", 20, 3)).toBe("0.30"); // preço com vírgula
  });

  it("variantes duplicadas no carrinho são consultadas uma vez só", async () => {
    const d = deps();
    await handleDiscountCallback(
      payload({
        products: [
          { variant_id: 10, quantity: 1, price: "10.00" },
          { variant_id: "10", quantity: 2, price: "10.00" },
        ],
      }),
      d,
    );
    expect(d.getWholesalePrices).toHaveBeenCalledWith(123, [10]);
  });

  it("carrinho em BRL → create_or_update_discount em BRL (comportamento de sempre)", async () => {
    const r = await handleDiscountCallback(payload({ currency: "BRL" }), deps());
    expect(r.status).toBe(200);
    expect((r.body as { commands: { specs: { currency: string } }[] }).commands[0].specs.currency).toBe("BRL");
  });

  it.each(["ARS", "MXN", "USD", "COP"])("carrinho em %s → desconto na moeda do carrinho, mesmo cálculo em centavos", async (currency) => {
    // (10.00 − 8.00) × 3 = 6.00
    const r = await handleDiscountCallback(payload({ currency }), deps());
    expect(r).toEqual({
      status: 200,
      body: {
        commands: [
          {
            command: "create_or_update_discount",
            specs: {
              promotion_id: "promo-1",
              currency,
              display_text: { "pt-br": "Atacado", "es-ar": "Mayorista", "es-mx": "Mayorista", "en-us": "Wholesale" },
              discount_specs: { type: "fixed", amount: "6.00" },
            },
          },
        ],
      },
    });
  });

  it("moeda sem centavos (CLP): amount continua com 2 casas e ponto, como a doc pede", async () => {
    // (15000 − 12000) × 3 = 9000
    const r = await handleDiscountCallback(
      payload({ currency: "CLP", products: [{ variant_id: 10, quantity: 3, price: "15000" }] }),
      deps({ prices: [[10, 1_200_000]] }),
    );
    const specs = (r.body as { commands: { specs: { currency: string; discount_specs: { amount: string } } }[] }).commands[0].specs;
    expect(specs.currency).toBe("CLP");
    expect(specs.discount_specs.amount).toBe("9000.00");
  });

  it("ARS abaixo do mínimo → remove_discount (sem moeda no comando)", async () => {
    const r = await handleDiscountCallback(
      payload({ currency: "ARS", products: [{ variant_id: 10, quantity: 2, price: "10.00" }] }),
      deps(),
    );
    expect(r.body).toEqual({ commands: [{ command: "remove_discount", specs: { scope: "cart", promotion_ids: ["promo-1"] } }] });
  });

  it.each([undefined, null, "", 986, "brl", "BRL ", " ARS", "BR", "BRLL", "R$", {}, ["BRL"]])(
    "currency ausente/inválida %j → 204 sem consultar nada (não adivinha a moeda)",
    async (currency) => {
      const d = deps();
      const r = await handleDiscountCallback(payload({ currency }), d);
      expect(r).toEqual({ status: 204, body: null });
      expect(d.getConfig).not.toHaveBeenCalled();
      expect(d.getWholesalePrices).not.toHaveBeenCalled();
    },
  );

  it("moeda inválida tem prioridade sobre loja não configurada (204, não 310)", async () => {
    const r = await handleDiscountCallback(payload({ currency: undefined }), deps({ config: null }));
    expect(r.status).toBe(204);
  });

  it("moeda válida e loja não configurada → 310", async () => {
    const r = await handleDiscountCallback(payload({ currency: "ARS" }), deps({ config: null }));
    expect(r.status).toBe(310);
  });

  it("remove_discount também segue o formato specs da doc (sem scope/promotion_ids no topo)", async () => {
    const r = await handleDiscountCallback(payload({ products: [] }), deps());
    const cmd = (r.body as { commands: Record<string, unknown>[] }).commands[0];
    expect(Object.keys(cmd).sort()).toEqual(["command", "specs"]);
  });
});

describe("handleDiscountCallback — produtos malformados são ignorados", () => {
  const ok = { variant_id: 10, quantity: 3, price: "10.00" };

  it.each([
    ["variant_id ausente", { quantity: 3, price: "10.00" }],
    ["variant_id texto", { variant_id: "abc", quantity: 3, price: "10.00" }],
    ["variant_id 0", { variant_id: 0, quantity: 3, price: "10.00" }],
    ["quantidade negativa", { variant_id: 10, quantity: -3, price: "10.00" }],
    ["quantidade 0", { variant_id: 10, quantity: 0, price: "10.00" }],
    ["quantidade fracionada", { variant_id: 10, quantity: 1.5, price: "10.00" }],
    ["quantidade texto", { variant_id: 10, quantity: "três", price: "10.00" }],
    ["quantidade vazia", { variant_id: 10, quantity: "", price: "10.00" }],
    ["quantidade null", { variant_id: 10, quantity: null, price: "10.00" }],
    ["preço ausente", { variant_id: 10, quantity: 3 }],
    ["preço inválido", { variant_id: 10, quantity: 3, price: "abc" }],
    ["preço negativo", { variant_id: 10, quantity: 3, price: "-10.00" }],
  ])("%s → item não conta (remove_discount)", async (_label, product) => {
    const r = await handleDiscountCallback(payload({ products: [product] }), deps());
    expect((r.body as { commands: { command: string }[] }).commands[0].command).toBe("remove_discount");
  });

  it.each([null, "x", 42, [null], ["x", 1]])("products/itens não-objeto %j não quebram", async (products) => {
    const r = await handleDiscountCallback(
      payload({ products: products as DiscountCallbackPayload["products"] }),
      deps(),
    );
    expect(r.status).toBe(200);
  });

  it("item válido continua contando ao lado de itens inválidos", async () => {
    const r = await handleDiscountCallback(
      payload({ products: [null as never, { variant_id: 10, quantity: -1, price: "10.00" }, ok] }),
      deps(),
    );
    // (10.00 − 8.00) × 3
    expect((r.body as { commands: { specs: { discount_specs: { amount: string } } }[] }).commands[0].specs.discount_specs.amount).toBe("6.00");
  });
});

describe("parseCart", () => {
  it("normaliza ids e preço; product_id inválido vira undefined", () => {
    expect(parseCart([{ variant_id: "10", product_id: "x", quantity: "2", price: 10.5 }])).toEqual([
      { variantId: 10, productId: undefined, quantity: 2, priceCents: 1050 },
    ]);
  });

  it("não-array → []", () => {
    expect(parseCart(undefined)).toEqual([]);
  });
});

describe("handleDiscountCallback — falhas das dependências", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("getConfig lançando → a promise rejeita (a rota converte em 204)", async () => {
    const d = deps();
    d.getConfig.mockRejectedValueOnce(new Error("db fora"));
    await expect(handleDiscountCallback(payload(), d)).rejects.toThrow("db fora");
  });

  it("getWholesalePrices lançando → a promise rejeita", async () => {
    const d = deps();
    d.getWholesalePrices.mockRejectedValueOnce(new Error("timeout"));
    await expect(handleDiscountCallback(payload(), d)).rejects.toThrow("timeout");
  });

  it("config e preços são buscados em paralelo", async () => {
    let releaseConfig!: (c: StoreConfig) => void;
    const d = deps();
    d.getConfig.mockImplementationOnce(() => new Promise((res) => (releaseConfig = res)));
    const p = handleDiscountCallback(payload(), d);
    await Promise.resolve();
    expect(d.getWholesalePrices).toHaveBeenCalled(); // não esperou a config
    releaseConfig(CONFIG);
    expect((await p).status).toBe(200);
  });
});

describe("parseCart — formatos de preço e quantidade", () => {
  it("preço com 3+ casas é arredondado para centavos", () => {
    expect(parseCart([{ variant_id: 10, quantity: 3, price: "10.000" }])[0].priceCents).toBe(1000);
    expect(parseCart([{ variant_id: 10, quantity: 3, price: "10.005" }])[0].priceCents).toBe(1001);
  });
  it.each([true, "0x10", "1e2", [3]])("quantidade estranha %j é ignorada", (quantity) => {
    expect(parseCart([{ variant_id: 10, quantity, price: "10.00" }])).toEqual([]);
  });
  it("quantidade numérica em string é aceita", () => {
    expect(parseCart([{ variant_id: 10, quantity: "3", price: "10.00" }])[0].quantity).toBe(3);
  });
});

describe("parseCart — arredondamento de preço com 3+ casas (sem erro de float)", () => {
  it.each([
    ["1.005", 101],
    ["10.004", 1000],
    ["10,555", 1056],
    ["0.995", 100],
  ])("%s → %i centavos", (price, cents) => {
    expect(parseCart([{ variant_id: 10, quantity: 1, price }])[0].priceCents).toBe(cents);
  });
});

describe("displayText — texto do desconto visível no carrinho/checkout", () => {
  const BASE = { "pt-br": "Atacado", "es-ar": "Mayorista", "es-mx": "Mayorista", "en-us": "Wholesale" };

  it.each([undefined, null, "", 42, {}, "fr", "fr-FR", "x", "español", "es--ar", "es-arg"])(
    "language %j (ausente/não suportado/malformado) → só as traduções padrão",
    (language) => {
      expect(displayText(language)).toEqual(BASE);
    },
  );

  it.each([
    ["es", { es: "Mayorista" }],
    ["ES", { es: "Mayorista" }],
    ["pt", { pt: "Atacado" }],
    ["en", { en: "Wholesale" }],
    ["es_CO", { "es-co": "Mayorista" }],
    ["es-CL", { "es-cl": "Mayorista" }],
    ["en-GB", { "en-gb": "Wholesale" }],
  ])("language %j → acrescenta a chave do idioma do carrinho", (language, extra) => {
    expect(displayText(language)).toEqual({ ...BASE, ...extra });
  });

  it("chave já existente não é sobrescrita (pt_BR → pt-br continua Atacado)", () => {
    expect(displayText("pt_BR")).toEqual(BASE);
  });

  it("não compartilha o objeto entre chamadas", () => {
    displayText("es").extra = "x";
    expect(displayText(undefined)).toEqual(BASE);
  });

  it("callback usa o language do payload no display_text", async () => {
    const r = await handleDiscountCallback(payload({ language: "es" }), deps());
    const specs = (r.body as { commands: { specs: { display_text: Record<string, string> } }[] }).commands[0].specs;
    expect(specs.display_text.es).toBe("Mayorista");
    expect(specs.display_text["pt-br"]).toBe("Atacado");
  });
});

describe("parseCurrency", () => {
  it.each(["BRL", "ARS", "CLP", "MXN", "USD"])("%s → ele mesmo", (c) => {
    expect(parseCurrency(c)).toBe(c);
  });
  it.each([undefined, null, "", "brl", "Brl", "BR", "BRLX", " BRL", "BRL\n", "R$", 986, {}])("%j → null", (c) => {
    expect(parseCurrency(c)).toBeNull();
  });
});
