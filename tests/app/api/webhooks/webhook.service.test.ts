import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/tests/helpers/fake-db";

const { db, fake } = await vi.hoisted(async () => (await import("@/tests/helpers/fake-db")).createFakeDb());
vi.mock("@/lib/db", () => ({ db }));

import { POST as appUninstalled } from "@/app/api/webhooks/app-uninstalled/route";
import { POST as customersDataRequest } from "@/app/api/webhooks/customers-data-request/route";
import { POST as customersRedact } from "@/app/api/webhooks/customers-redact/route";
import { POST as storeRedact } from "@/app/api/webhooks/store-redact/route";
import { deleteStoreData, readSignedWebhook } from "@/app/api/webhooks/webhook.service";

const f = fake as FakeDb;
const SECRET = "segredo-de-teste";
const sign = (raw: string, secret = SECRET) => createHmac("sha256", secret).update(raw, "utf8").digest("hex");

function webhook(raw: string, signature: string | null = sign(raw)) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-linkedstore-hmac-sha256"] = signature;
  return new Request("https://api.test/api/webhooks/x", { method: "POST", body: raw, headers });
}

beforeEach(() => {
  f.reset();
  vi.stubEnv("CLIENT_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readSignedWebhook", () => {
  it("assinatura válida → body parseado", async () => {
    const raw = JSON.stringify({ store_id: 123 });
    expect(await readSignedWebhook(webhook(raw))).toEqual({ body: { store_id: 123 } });
  });

  it("valida sobre o body cru com unicode", async () => {
    const raw = '{"store_id":1,"nome":"Pão de Açúcar ☕"}';
    const r = await readSignedWebhook(webhook(raw));
    expect("body" in r && r.body.nome).toBe("Pão de Açúcar ☕");
  });

  it.each([
    ["assinatura errada", sign("outro body")],
    ["assinatura com outro segredo", sign('{"store_id":1}', "outro")],
    ["sem header", null],
    ["header vazio", ""],
  ])("%s → 401", async (_l, sig) => {
    const r = await readSignedWebhook(webhook('{"store_id":1}', sig));
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.status).toBe(401);
      expect(await r.error.json()).toEqual({ message: "invalid signature" });
    }
  });

  it("CLIENT_SECRET ausente → 401 mesmo com assinatura de segredo vazio", async () => {
    vi.stubEnv("CLIENT_SECRET", "");
    const raw = '{"store_id":1}';
    const r = await readSignedWebhook(webhook(raw, sign(raw, "")));
    expect("error" in r && r.error.status).toBe(401);
  });

  it("assinatura válida mas JSON inválido → 400", async () => {
    const raw = "{nao é json";
    const r = await readSignedWebhook(webhook(raw));
    expect("error" in r && r.error.status).toBe(400);
  });

  it("body vazio assinado → 400", async () => {
    const r = await readSignedWebhook(webhook("", sign("")));
    expect("error" in r && r.error.status).toBe(400);
  });

  it("assinatura é checada antes do JSON (JSON inválido sem assinatura → 401)", async () => {
    const r = await readSignedWebhook(webhook("{", "00"));
    expect("error" in r && r.error.status).toBe(401);
  });
});

describe("deleteStoreData", () => {
  it.each([undefined, null, "", "abc", 0, -1, "0", 1.5, "007", {}])("store_id inválido %j → false sem tocar no banco", async (id) => {
    expect(await deleteStoreData(id)).toBe(false);
    expect(f.chains).toHaveLength(0);
  });

  it("store_id válido → apaga a loja e devolve true", async () => {
    expect(await deleteStoreData("123")).toBe(true);
    expect(f.methods(0)).toEqual(["delete", "where"]);
  });

  it("erro do banco propaga (a rota decide o status)", async () => {
    f.queue(new Error("neon fora"));
    await expect(deleteStoreData(123)).rejects.toThrow("neon fora");
  });
});

describe.each([
  ["app-uninstalled", appUninstalled],
  ["store-redact", storeRedact],
])("POST /api/webhooks/%s", (_name, POST) => {
  const raw = JSON.stringify({ store_id: 123 });

  it("ok → 200 { ok: true }", async () => {
    const res = await POST(webhook(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(f.chains).toHaveLength(1);
  });

  it("banco lançando → 500 (para a Nuvemshop reenviar), sem vazar o erro", async () => {
    f.queue(new Error("connection refused 10.0.0.1"));
    const res = await POST(webhook(raw));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("10.0.0.1");
    expect(res.headers.get("x-request-id")).toBe(JSON.parse(text).requestId);
  });

  it("assinatura inválida → 401 e não apaga nada", async () => {
    const res = await POST(webhook(raw, sign("x")));
    expect(res.status).toBe(401);
    expect(f.chains).toHaveLength(0);
  });

  it("JSON inválido assinado → 400 e não apaga nada", async () => {
    const res = await POST(webhook("{", sign("{")));
    expect(res.status).toBe(400);
    expect(f.chains).toHaveLength(0);
  });
});

describe("POST /api/webhooks/app-uninstalled — payload assinado que não é objeto", () => {
  // QUESTIONÁVEL: readSignedWebhook tipa body como Record, mas aceita qualquer JSON.
  it.each(["null", "[]", "42", "\"x\""])("%s assinado → 400 sem tocar no banco", async (raw) => {
    const res = await appUninstalled(webhook(raw));
    expect(res.status).toBe(400);
    expect(f.chains).toHaveLength(0);
  });

  it("store_id inválido assinado → 200 sem apagar nada (sem retry)", async () => {
    const res = await appUninstalled(webhook(JSON.stringify({ store_id: "abc" })));
    expect(res.status).toBe(200);
    expect(f.chains).toHaveLength(0);
  });
});

describe.each([
  ["customers-data-request", customersDataRequest],
  ["customers-redact", customersRedact],
])("POST /api/webhooks/%s", (_name, POST) => {
  it("assinatura válida → 200 sem tocar no banco", async () => {
    const raw = JSON.stringify({ store_id: 1, customer: { id: 2 } });
    const res = await POST(webhook(raw));
    expect(res.status).toBe(200);
    expect(f.chains).toHaveLength(0);
  });

  it("assinatura inválida → 401", async () => {
    const res = await POST(webhook("{}", null));
    expect(res.status).toBe(401);
  });
});
