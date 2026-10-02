import { createHmac } from "node:crypto";
import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";

vi.mock("@/lib/db", () => ({ db: {} }));

const nuvemshopClientFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/nuvemshop", () => ({ nuvemshopClientFor, nuvemshopClient: vi.fn(), USER_AGENT: "teste" }));

const setup = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/auth/callback/auth.service", () => ({ authService: { setup } }));

import { POST } from "@/app/api/setup/route";

const SECRET = "segredo-de-teste";
const API = { fake: true } as unknown as AxiosInstance;

function token(storeId: unknown, exp = Math.floor(Date.now() / 1000) + 300) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ storeId, exp });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

const call = (authorization?: string) =>
  POST(
    new Request("https://api.test/api/setup", { method: "POST", headers: authorization ? { authorization } : {} }),
    undefined,
  );

const ALL_OK = { promotion: { ok: true }, discountCallback: { ok: true }, uninstallWebhook: { ok: true } };

beforeEach(() => {
  vi.stubEnv("CLIENT_SECRET", SECRET);
  nuvemshopClientFor.mockReset().mockResolvedValue(API);
  setup.mockReset().mockResolvedValue(ALL_OK);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/setup", () => {
  it.each([undefined, "Bearer abc.def.ghi", `Basic ${token(1)}`])("sem token válido (%j) → 401 sem tocar na Nuvemshop", async (auth) => {
    const res = await call(auth);
    expect(res.status).toBe(401);
    expect(nuvemshopClientFor).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it("token expirado → 401", async () => {
    const res = await call(`Bearer ${token(123, Math.floor(Date.now() / 1000) - 1)}`);
    expect(res.status).toBe(401);
  });

  it("todos os passos ok → 200 { ready: true }", async () => {
    const res = await call(`Bearer ${token(123)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ready: true,
      steps: { promotion: true, discountCallback: true, uninstallWebhook: true },
    });
    expect(nuvemshopClientFor).toHaveBeenCalledWith(123);
    expect(setup).toHaveBeenCalledWith(123, API);
  });

  it.each(["promotion", "discountCallback", "uninstallWebhook"] as const)("passo %s falhando → 502 { ready: false }", async (step) => {
    setup.mockResolvedValue({ ...ALL_OK, [step]: { ok: false, error: "detalhe interno do banco" } });
    const res = await call(`Bearer ${token(123)}`);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.steps[step]).toBe(false);
    // o detalhe do erro não vai para o navegador
    expect(JSON.stringify(body)).not.toContain("detalhe interno");
  });

  it("loja sem token no banco (nuvemshopClientFor → ApiError 401) → 401 e setup não roda", async () => {
    nuvemshopClientFor.mockRejectedValue(new ApiError("loja não instalada", 401, "store_not_installed"));
    const res = await call(`Bearer ${token(123)}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "loja não instalada", code: "store_not_installed" });
    expect(setup).not.toHaveBeenCalled();
  });

  it("erro inesperado (ex.: decrypt com chave errada) → 500 com x-request-id e sem detalhe", async () => {
    nuvemshopClientFor.mockRejectedValue(new Error("Unsupported state or unable to authenticate data"));
    const res = await call(`Bearer ${token(123)}`);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.text()).not.toContain("authenticate data");
  });

  it("setup lançando (não deveria) → 500", async () => {
    setup.mockRejectedValue(new Error("x"));
    const res = await call(`Bearer ${token(123)}`);
    expect(res.status).toBe(500);
  });
});
