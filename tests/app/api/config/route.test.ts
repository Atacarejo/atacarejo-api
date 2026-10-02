import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { storeConfig, stores, wholesalePrices } from "@/db/schema";
import type { FakeDb } from "@/tests/helpers/fake-db";

const { db, fake } = await vi.hoisted(async () => (await import("@/tests/helpers/fake-db")).createFakeDb());
vi.mock("@/lib/db", () => ({ db }));

const getStoreConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/store-config", async (orig) => ({ ...(await orig<object>()), getStoreConfig }));

import { GET, PUT } from "@/app/api/config/route";

const f = fake as FakeDb;
const SECRET = "segredo-de-teste";

function token(storeId: number) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ storeId, exp: Math.floor(Date.now() / 1000) + 300 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

const AUTH = { authorization: `Bearer ${token(123)}` };
const get = (headers: Record<string, string> = AUTH) => GET(new Request("https://api.test/api/config", { headers }), undefined);
const put = (body: string, headers: Record<string, string> = AUTH) =>
  PUT(new Request("https://api.test/api/config", { method: "PUT", body, headers: { ...headers, "content-type": "application/json" } }), undefined);

const CONFIG = { promotionId: "77", minQuantity: 5, atcStoreType: "all", designOption: 2 };

beforeEach(() => {
  f.reset();
  getStoreConfig.mockReset().mockResolvedValue(CONFIG);
  vi.stubEnv("CLIENT_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/config", () => {
  it("sem token → 401 sem consultar nada", async () => {
    const res = await get({});
    expect(res.status).toBe(401);
    expect(getStoreConfig).not.toHaveBeenCalled();
    expect(f.chains).toHaveLength(0);
  });

  it("loja configurada e com preços → ready true, hasWholesalePrices true, sem promotionId no body", async () => {
    f.queue([{ id: 10 }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ minQuantity: 5, atcStoreType: "all", designOption: 2, ready: true, hasWholesalePrices: true });
    expect(getStoreConfig).toHaveBeenCalledWith(123);
  });

  it("consulta de preços é limitada a 1 linha da loja", async () => {
    f.queue([]);
    await get();
    expect(f.methods(0)).toEqual(["select", "from", "where", "limit"]);
    expect(f.argsOf(0, "from")).toEqual([wholesalePrices]);
    expect(f.argsOf(0, "limit")).toEqual([1]);
  });

  it("sem preços → hasWholesalePrices false", async () => {
    f.queue([]);
    expect((await (await get()).json()).hasWholesalePrices).toBe(false);
  });

  it("sem linha em store_config → padrões, ready false", async () => {
    getStoreConfig.mockResolvedValue(null);
    f.queue([]);
    expect(await (await get()).json()).toEqual({
      minQuantity: 3,
      atcStoreType: "all",
      designOption: 1,
      ready: false,
      hasWholesalePrices: false,
    });
  });

  it("promotionId null (promoção não criada no install) → ready false", async () => {
    getStoreConfig.mockResolvedValue({ ...CONFIG, promotionId: null });
    f.queue([{ id: 1 }]);
    const body = await (await get()).json();
    expect(body.ready).toBe(false);
    expect(body.hasWholesalePrices).toBe(true);
  });

  it("config e preços são consultados em paralelo", async () => {
    let release!: (v: unknown) => void;
    getStoreConfig.mockReturnValue(new Promise((r) => (release = r)));
    f.queue([]);
    const p = get();
    await new Promise((r) => setImmediate(r));
    expect(f.chains).toHaveLength(1); // a query de preços já saiu sem esperar a config
    release(CONFIG);
    expect((await p).status).toBe(200);
  });

  it("getStoreConfig lançando → 500 com x-request-id", async () => {
    getStoreConfig.mockRejectedValue(new Error("neon fora"));
    f.queue([]);
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("consulta de preços lançando → 500", async () => {
    f.queue(new Error("neon fora"));
    expect((await get()).status).toBe(500);
  });
});

describe("PUT /api/config", () => {
  it("sem token → 401 sem tocar no banco", async () => {
    const res = await put(JSON.stringify({ minQuantity: 5 }), {});
    expect(res.status).toBe(401);
    expect(f.chains).toHaveLength(0);
  });

  it("JSON inválido → 400 sem tocar no banco", async () => {
    const res = await put("{");
    expect(res.status).toBe(400);
    expect(f.chains).toHaveLength(0);
  });

  it("body inválido → 400 antes de checar a loja", async () => {
    const res = await put(JSON.stringify({ minQuantity: 0 }));
    expect(res.status).toBe(400);
    expect(f.chains).toHaveLength(0);
  });

  it("loja inexistente em stores → 401 \"loja não instalada\" e não insere config órfã", async () => {
    f.queue([]);
    const res = await put(JSON.stringify({ minQuantity: 5 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "loja não instalada" });
    expect(f.chains).toHaveLength(1);
    expect(f.argsOf(0, "from")).toEqual([stores]);
  });

  it("loja existe → upsert com o storeId do token (nunca do body) e devolve a linha", async () => {
    const row = { minQuantity: 5, atcStoreType: "all", designOption: 2 };
    f.queue([{ id: 123 }], [row]);
    const res = await put(JSON.stringify({ minQuantity: 5, storeId: 999 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(row);
    expect(f.argsOf(1, "insert")).toEqual([storeConfig]);
    expect(f.argsOf(1, "values")).toEqual([{ storeId: 123, minQuantity: 5 }]);
    expect(f.argsOf(1, "onConflictDoUpdate")).toEqual([expect.objectContaining({ set: { minQuantity: 5 } })]);
  });

  it("banco lançando na checagem da loja → 500", async () => {
    f.queue(new Error("neon fora"));
    expect((await put(JSON.stringify({ minQuantity: 5 }))).status).toBe(500);
  });
});
