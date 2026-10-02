import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/tests/helpers/fake-db";

const { db, fake } = await vi.hoisted(async () => (await import("@/tests/helpers/fake-db")).createFakeDb());
vi.mock("@/lib/db", () => ({ db }));

const getStoreConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/store-config", async (orig) => ({ ...(await orig<object>()), getStoreConfig }));

import { POST } from "@/app/api/callbacks/discounts/route";

const f = fake as FakeDb;
const CONFIG = { promotionId: "77", minQuantity: 3, atcStoreType: "all", designOption: 1 };

const post = (body: string) =>
  POST(new Request("https://api.test/api/callbacks/discounts", { method: "POST", body, headers: { "content-type": "application/json" } }));

const cart = (quantity: number) =>
  JSON.stringify({
    store_id: 123,
    currency: "BRL",
    execution_tier: "cross_items",
    products: [
      { variant_id: 10, product_id: 1, quantity, price: "10.00" },
      { variant_id: 20, product_id: 2, quantity: 5, price: "50.00" },
    ],
  });

beforeEach(() => {
  f.reset();
  getStoreConfig.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/callbacks/discounts", () => {
  it.each(["{", "", "not json", "{\"store_id\":"])("body inválido %j → 204 sem body", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it.each(["null", "[]", "42", "\"x\""])("JSON válido mas não-objeto %j → 204", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(204);
  });

  it("getStoreConfig lançando → 204 (nunca trava o checkout)", async () => {
    getStoreConfig.mockRejectedValue(new Error("neon fora"));
    const res = await post(cart(3));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("consulta de preços lançando → 204", async () => {
    getStoreConfig.mockResolvedValue(CONFIG);
    f.queue(new Error("timeout"));
    const res = await post(cart(3));
    expect(res.status).toBe(204);
  });

  it("loja sem promoção → 310 sem body", async () => {
    getStoreConfig.mockResolvedValue(null);
    const res = await post(cart(3));
    expect(res.status).toBe(310);
    expect(await res.text()).toBe("");
  });

  it("no mínimo → 200 com create_or_update_discount; linha com preço 0.00 no banco é ignorada", async () => {
    getStoreConfig.mockResolvedValue(CONFIG);
    // variante 20 tem "0.00" no banco = sem atacado → não conta nem dá desconto
    f.queue([
      { variantId: 10, price: "8.00" },
      { variantId: 20, price: "0.00" },
    ]);
    const res = await post(cart(3));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      commands: [
        {
          command: "create_or_update_discount",
          specs: {
            promotion_id: "77",
            currency: "BRL",
            display_text: { "pt-br": "Atacado" },
            discount_specs: { type: "fixed", amount: "6.00" },
          },
        },
      ],
    });
  });

  it("preço 0.00 no banco não completa o mínimo → remove_discount", async () => {
    getStoreConfig.mockResolvedValue(CONFIG);
    f.queue([
      { variantId: 10, price: "8.00" },
      { variantId: 20, price: "0.00" },
    ]);
    const res = await post(cart(2));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commands: [{ command: "remove_discount", specs: { scope: "cart", promotion_ids: ["77"] } }] });
  });

  it("consulta preços só das variantes do carrinho (uma query, filtrada por loja)", async () => {
    getStoreConfig.mockResolvedValue(CONFIG);
    f.queue([]);
    await post(cart(3));
    expect(f.chains).toHaveLength(1);
    expect(f.methods(0)).toEqual(["select", "from", "where"]);
    expect(getStoreConfig).toHaveBeenCalledWith(123);
  });
});

describe("POST /api/callbacks/discounts — timeout interno de 700 ms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("service que nunca resolve → 204 aos 700 ms", async () => {
    getStoreConfig.mockReturnValue(new Promise(() => {}));
    f.queue([{ variantId: 10, price: "8.00" }]);
    let settled: Response | null = null;
    const p = post(cart(3)).then((r) => (settled = r));

    await vi.advanceTimersByTimeAsync(699);
    expect(settled).toBeNull(); // ainda esperando

    await vi.advanceTimersByTimeAsync(1);
    const res = await p;
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(console.warn).toHaveBeenCalled();
  });

  it("resposta rápida não espera o timeout e limpa o timer", async () => {
    getStoreConfig.mockResolvedValue(CONFIG);
    f.queue([{ variantId: 10, price: "8.00" }]);
    const res = await post(cart(3));
    expect(res.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("erro antes do timeout → 204 imediato e timer limpo", async () => {
    getStoreConfig.mockRejectedValue(new Error("neon fora"));
    const res = await post(cart(3));
    expect(res.status).toBe(204);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejeição do service depois do timeout não vira unhandled rejection", async () => {
    let reject!: (e: Error) => void;
    getStoreConfig.mockReturnValue(new Promise((_r, rej) => (reject = rej)));
    const p = post(cart(3));
    await vi.advanceTimersByTimeAsync(700);
    expect((await p).status).toBe(204);
    reject(new Error("tarde demais"));
    await vi.advanceTimersByTimeAsync(0);
  });
});
