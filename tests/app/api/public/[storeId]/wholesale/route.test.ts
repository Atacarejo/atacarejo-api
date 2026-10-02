import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/tests/helpers/fake-db";

const { db, fake } = await vi.hoisted(async () => (await import("@/tests/helpers/fake-db")).createFakeDb());
vi.mock("@/lib/db", () => ({ db }));

import { GET as getWholesale, OPTIONS as optionsWholesale } from "@/app/api/public/[storeId]/wholesale/route";

const f = fake as FakeDb;

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

describe("GET /api/public/[storeId]/wholesale", () => {
  it.each(["abc", "0", "1.5", "-1", "007", ""])("storeId inválido %j → 400 com CORS", async (storeId) => {
    const res = await getWholesale(req(`/api/public/${storeId}/wholesale`), ctx(storeId));
    expect(res.status).toBe(400);
    expectCors(res);
    expect(f.chains).toHaveLength(0);
  });

  it("ok → lista no contrato { product_id, variant_id, price_atc }", async () => {
    const rows = [
      { product_id: 1, variant_id: 10, price_atc: "8.00" },
      { product_id: 1, variant_id: 11, price_atc: "7.50" },
    ];
    f.queue(rows);
    const res = await getWholesale(req("/api/public/123/wholesale"), ctx("123"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    expectCors(res);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=30/);
  });

  it("loja sem preços → []", async () => {
    f.queue([]);
    const res = await getWholesale(req("/api/public/123/wholesale"), ctx("123"));
    expect(await res.json()).toEqual([]);
  });

  it("banco lançando → 500 com CORS, sem vazar o erro", async () => {
    f.queue(new Error("password authentication failed for neondb_owner"));
    const res = await getWholesale(req("/api/public/123/wholesale"), ctx("123"));
    expect(res.status).toBe(500);
    expectCors(res);
    // 500 não pode ficar no cache da CDN e precisa do Request-ID
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain("neondb_owner");
    expect(res.headers.get("x-request-id")).toBe(JSON.parse(text).requestId);
  });

  it("OPTIONS → 204 com CORS", async () => {
    const res = optionsWholesale();
    expect(res.status).toBe(204);
    expectCors(res);
  });
});
