import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/tests/helpers/fake-db";

const { db, fake } = await vi.hoisted(async () => (await import("@/tests/helpers/fake-db")).createFakeDb());
vi.mock("@/lib/db", () => ({ db }));

import { GET as getConfig, OPTIONS as optionsConfig } from "@/app/api/public/[storeId]/config/route";

const f = fake as FakeDb;
const DEFAULTS = { min_quantity: 3, atc_store_type: "all", design_option: 1 };

const ctx = (storeId: string) => ({ params: Promise.resolve({ storeId }) });
const req = (path: string) => new Request(`https://api.test${path}`);

function expectCors(res: Response) {
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
}

beforeEach(() => {
  f.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/public/[storeId]/config", () => {
  it.each(["abc", "0", "1.5", "-1", "007", "", "1e3", "99999999999999999"])(
    "storeId inválido %j → 200 com os padrões, CORS e sem consultar o banco",
    async (storeId) => {
      const res = await getConfig(req(`/api/public/${storeId}/config`), ctx(storeId));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(DEFAULTS);
      expectCors(res);
      expect(f.chains).toHaveLength(0);
    },
  );

  it("loja sem linha em store_config → padrões", async () => {
    f.queue([]);
    const res = await getConfig(req("/api/public/123/config"), ctx("123"));
    expect(await res.json()).toEqual(DEFAULTS);
  });

  it("loja configurada → valores do banco em snake_case, sem campos internos", async () => {
    f.queue([{ promotionId: "secreto", minQuantity: 6, atcStoreType: "all", designOption: 1 }]);
    const res = await getConfig(req("/api/public/123/config"), ctx("123"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ min_quantity: 6, atc_store_type: "all", design_option: 1 });
    expectCors(res);
  });

  it("modelo salvo que não existe mais → SDK recebe o modelo padrão", async () => {
    f.queue([{ promotionId: "1", minQuantity: 6, atcStoreType: "all", designOption: 42 }]);
    const res = await getConfig(req("/api/public/123/config"), ctx("123"));
    expect(await res.json()).toEqual({ min_quantity: 6, atc_store_type: "all", design_option: 1 });
  });

  it("banco lançando → ainda 200 com os padrões e CORS", async () => {
    f.queue(new Error("neon fora"));
    const res = await getConfig(req("/api/public/123/config"), ctx("123"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULTS);
    expectCors(res);
    // o padrão devolvido por erro não pode ficar 30 s no cache da CDN
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("loja configurada (sem erro) mantém o cache curto", async () => {
    f.queue([{ promotionId: "1", minQuantity: 6, atcStoreType: "all", designOption: 1 }]);
    const res = await getConfig(req("/api/public/123/config"), ctx("123"));
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=30/);
  });

  it("tem cache curto na CDN", async () => {
    const res = await getConfig(req("/api/public/abc/config"), ctx("abc"));
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=30/);
  });

  it("OPTIONS → 204 com CORS", async () => {
    const res = optionsConfig();
    expect(res.status).toBe(204);
    expectCors(res);
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });
});
