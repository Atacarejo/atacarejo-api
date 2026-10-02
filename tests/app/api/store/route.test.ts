import { createHmac } from "node:crypto";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";

vi.mock("@/lib/db", () => ({ db: {} }));

const apiGet = vi.hoisted(() => vi.fn());
const nuvemshopClientFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/nuvemshop", async (orig) => ({ ...(await orig<object>()), nuvemshopClientFor }));

import { GET } from "@/app/api/store/route";

const SECRET = "segredo-de-teste";

function token(storeId: number) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ storeId, exp: Math.floor(Date.now() / 1000) + 300 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

const get = (headers: Record<string, string> = { authorization: `Bearer ${token(123)}` }) =>
  GET(new Request("https://api.test/api/store", { headers }), undefined);

function axiosError(status: number) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("x", "ERR", config, null, { status, statusText: "", headers: {}, config, data: {} });
}

beforeEach(() => {
  apiGet.mockReset();
  nuvemshopClientFor.mockReset().mockResolvedValue({ get: apiGet });
  vi.stubEnv("CLIENT_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/store", () => {
  it("sem token → 401 sem chamar a Nuvemshop", async () => {
    const res = await get({});
    expect(res.status).toBe(401);
    expect(nuvemshopClientFor).not.toHaveBeenCalled();
  });

  it("loja da Argentina → es, AR, ARS (GET /store só com os campos usados)", async () => {
    apiGet.mockResolvedValue({ data: { main_language: "es", country: "AR", main_currency: "ARS" } });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ language: "es", country: "AR", currency: "ARS" });
    expect(nuvemshopClientFor).toHaveBeenCalledWith(123);
    expect(apiGet).toHaveBeenCalledWith("store", { params: { fields: "main_language,languages,country,main_currency" } });
  });

  it("loja do Brasil com pt_BR → pt", async () => {
    apiGet.mockResolvedValue({ data: { main_language: "pt_BR", country: "BR", main_currency: "BRL" } });
    expect(await (await get()).json()).toEqual({ language: "pt", country: "BR", currency: "BRL" });
  });

  it("sem main_language: usa o primeiro idioma ativo e a moeda dele", async () => {
    apiGet.mockResolvedValue({
      data: { country: "MX", languages: { pt: { active: false, currency: "BRL" }, es: { active: true, currency: "MXN" } } },
    });
    expect(await (await get()).json()).toEqual({ language: "es", country: "MX", currency: "MXN" });
  });

  it("resposta vazia → idioma pela regra do país (sem país → es) e campos null", async () => {
    apiGet.mockResolvedValue({ data: null });
    expect(await (await get()).json()).toEqual({ language: "es", country: null, currency: null });
  });

  it("loja sem token no banco → 401 store_not_installed", async () => {
    nuvemshopClientFor.mockRejectedValue(new ApiError("loja não instalada", 401, "store_not_installed"));
    const res = await get();
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("store_not_installed");
  });

  it.each([
    [429, 429, "rate_limited"],
    [401, 401, "invalid_token"],
    [500, 502, "nuvemshop_unavailable"],
  ])("Nuvemshop responde %i → %i %s", async (upstream, status, code) => {
    apiGet.mockRejectedValue(axiosError(upstream));
    const res = await get();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it("erro de rede → 502 nuvemshop_unavailable", async () => {
    apiGet.mockRejectedValue(new Error("ECONNRESET"));
    const res = await get();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("nuvemshop_unavailable");
  });
});
