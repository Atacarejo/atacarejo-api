import { AxiosError, AxiosHeaders, type AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stores, storeConfig } from "@/db/schema";
import { ApiError } from "@/lib/http";
import type { FakeDb } from "@/tests/helpers/fake-db";

const { db, fake } = await vi.hoisted(async () => (await import("@/tests/helpers/fake-db")).createFakeDb());
vi.mock("@/lib/db", () => ({ db }));

// axios.post é a troca de code por token; o resto do axios (isAxiosError, create) continua real
const axiosPost = vi.hoisted(() => vi.fn());
vi.mock("axios", async (orig) => {
  const actual = await orig<typeof import("axios")>();
  const wrapped = Object.assign(Object.create(actual.default), actual.default, { post: axiosPost });
  return { ...actual, default: wrapped };
});

const getStoreConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/store-config", async (orig) => ({ ...(await orig<object>()), getStoreConfig }));

const encrypt = vi.hoisted(() => vi.fn((s: string) => `enc(${s.length})`));
vi.mock("@/lib/crypto", () => ({ encrypt, decrypt: vi.fn() }));

const nuvemshopClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/nuvemshop", async (orig) => ({
  USER_AGENT: (await orig<typeof import("@/lib/nuvemshop")>()).USER_AGENT,
  nuvemshopClient,
  nuvemshopClientFor: vi.fn(),
}));

import { GET } from "@/app/api/auth/callback/route";
import { AuthService } from "@/app/api/auth/callback/auth.service";
import { USER_AGENT } from "@/lib/nuvemshop";

const f = fake as FakeDb;
const TOKEN = "tok_SUPER_SECRETO_123";
const APP = "https://api.atacarejo.test";
const HOOK_URL = `${APP}/api/webhooks/app-uninstalled`;

type FakeApi = {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

function httpError(status: number) {
  return new AxiosError(`Request failed with status code ${status} token=${TOKEN}`, "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    statusText: "x",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { access_token: TOKEN },
  });
}

/** API fake da Nuvemshop: tudo dá certo por padrão. */
function fakeApi(over: Partial<FakeApi> = {}): FakeApi {
  return {
    get: vi.fn(async (path: string) => {
      if (path === "webhooks") return { data: [] };
      if (path === "store") return { data: { original_domain: "loja.lojavirtualnuvem.com.br" } };
      if (path.startsWith("promotions/")) return { data: { id: path.split("/")[1] } };
      throw new Error(`GET inesperado ${path}`);
    }),
    post: vi.fn(async (path: string) => (path === "promotions" ? { data: { id: 555 } } : { data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    ...over,
  };
}

const asAxios = (api: FakeApi) => api as unknown as AxiosInstance;
const service = new AuthService();

beforeEach(() => {
  f.reset();
  axiosPost.mockReset();
  getStoreConfig.mockReset().mockResolvedValue({ promotionId: null, minQuantity: 3, atcStoreType: "all", designOption: 1 });
  nuvemshopClient.mockReset();
  encrypt.mockClear();
  vi.stubEnv("APP_URL", `${APP}/`);
  vi.stubEnv("CLIENT_ID", "4242");
  vi.stubEnv("CLIENT_SECRET", "segredo-de-teste");
  vi.stubEnv("NUVEMSHOP_TOKEN_URL", "https://token.nuvemshop.test/apps/authorize/token");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function apiErrorOf(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => {
      throw new Error("deveria ter rejeitado");
    },
    (e) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe("AuthService.install — troca de code por token", () => {
  it("code vazio → 400 sem chamar a Nuvemshop", async () => {
    const err = await apiErrorOf(service.install(""));
    expect(err.status).toBe(400);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it("falha HTTP na troca → ApiError 502 sem vazar a mensagem do axios", async () => {
    axiosPost.mockRejectedValue(httpError(400));
    const err = await apiErrorOf(service.install("code-usado"));
    expect(err.status).toBe(502);
    expect(err.message).not.toContain(TOKEN);
    expect(f.chains).toHaveLength(0);
  });

  it("timeout/rede na troca → 502", async () => {
    axiosPost.mockRejectedValue(new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED"));
    expect((await apiErrorOf(service.install("c"))).status).toBe(502);
  });

  it("envia client_id, client_secret, grant_type e code", async () => {
    axiosPost.mockRejectedValue(httpError(400));
    await service.install("abc").catch(() => {});
    expect(axiosPost).toHaveBeenCalledWith(
      "https://token.nuvemshop.test/apps/authorize/token",
      { client_id: "4242", client_secret: "segredo-de-teste", grant_type: "authorization_code", code: "abc" },
      expect.objectContaining({ timeout: 10_000, headers: { "User-Agent": USER_AGENT } }),
    );
  });

  it.each([
    ["data null", null],
    ["sem access_token", { user_id: 123, scope: "x" }],
    ["access_token vazio", { access_token: "", user_id: 123 }],
    ["user_id ausente", { access_token: TOKEN }],
    ["user_id inválido", { access_token: TOKEN, user_id: "abc" }],
    ["user_id 0", { access_token: TOKEN, user_id: 0 }],
    ["user_id negativo", { access_token: TOKEN, user_id: -1 }],
    ["resposta de erro com 200", { error: "invalid_grant", error_description: "code expirado" }],
  ])("%s → 502 e nada salvo", async (_l, data) => {
    axiosPost.mockResolvedValue({ data });
    const err = await apiErrorOf(service.install("c"));
    expect(err.status).toBe(502);
    expect(err.message).toBe("token not found");
    expect(f.chains).toHaveLength(0);
    expect(nuvemshopClient).not.toHaveBeenCalled();
  });
});

describe("AuthService.install — sucesso", () => {
  beforeEach(() => {
    axiosPost.mockResolvedValue({ data: { access_token: TOKEN, token_type: "bearer", scope: "write_products", user_id: "123" } });
  });

  it("salva a loja com o token criptografado (nunca o token cru) e cria a config", async () => {
    nuvemshopClient.mockReturnValue(asAxios(fakeApi()));
    const r = await service.install("c");

    expect(r.storeId).toBe(123);
    expect(encrypt).toHaveBeenCalledWith(TOKEN);
    expect(f.argsOf(0, "insert")).toEqual([stores]);
    expect(f.argsOf(0, "values")).toEqual([{ storeId: 123, accessToken: `enc(${TOKEN.length})`, scope: "write_products" }]);
    // nenhum argumento passado ao banco contém o token cru
    const dbArgs = f.chains.flat().flatMap((c) => c.args).filter((a) => a !== stores && a !== storeConfig);
    expect(JSON.stringify(dbArgs, (_k, v) => (typeof v === "object" && v?.constructor?.name?.startsWith("Pg") ? "[pg]" : v))).not.toContain(TOKEN);
    expect(f.argsOf(1, "insert")).toEqual([storeConfig]);
    expect(f.methods(1)).toContain("onConflictDoNothing");
    expect(nuvemshopClient).toHaveBeenCalledWith(123, TOKEN);
  });

  it("scope ausente vira string vazia (coluna notNull)", async () => {
    axiosPost.mockResolvedValue({ data: { access_token: TOKEN, user_id: 123 } });
    nuvemshopClient.mockReturnValue(asAxios(fakeApi()));
    await service.install("c");
    expect(f.argsOf(0, "values")).toEqual([expect.objectContaining({ scope: "" })]);
  });

  it("devolve adminUrl e o resultado de cada passo", async () => {
    nuvemshopClient.mockReturnValue(asAxios(fakeApi()));
    const r = await service.install("c");
    expect(r.adminUrl).toBe("https://loja.lojavirtualnuvem.com.br/admin/apps/4242");
    expect(r.setup).toEqual({ promotion: { ok: true }, discountCallback: { ok: true }, uninstallWebhook: { ok: true } });
  });

  it("falha no banco ao salvar a loja propaga (rota vira 500)", async () => {
    f.queue(new Error("neon fora"));
    await expect(service.install("c")).rejects.toThrow("neon fora");
    expect(nuvemshopClient).not.toHaveBeenCalled();
  });

  it("setup falhando inteiro não derruba a instalação", async () => {
    const boom = vi.fn(async () => {
      throw httpError(500);
    });
    nuvemshopClient.mockReturnValue(asAxios(fakeApi({ get: boom, post: boom, put: boom })));
    const r = await service.install("c");
    expect(r.storeId).toBe(123);
    expect(r.adminUrl).toBeNull();
    expect(Object.values(r.setup).every((s) => !s.ok)).toBe(true);
  });
});

describe("AuthService.setup — passos independentes", () => {
  it("promoção falhando ainda registra callback e webhook", async () => {
    const api = fakeApi({
      post: vi.fn(async (path: string) => {
        if (path === "promotions") throw httpError(422);
        return { data: {} };
      }),
    });
    const r = await service.setup(123, asAxios(api));
    expect(r.promotion).toEqual({ ok: false, error: "HTTP 422" });
    expect(r.discountCallback).toEqual({ ok: true });
    expect(r.uninstallWebhook).toEqual({ ok: true });
    expect(api.put).toHaveBeenCalledWith("discounts/callbacks", { url: `${APP}/api/callbacks/discounts` });
    expect(api.post).toHaveBeenCalledWith("webhooks", { event: "app/uninstalled", url: HOOK_URL });
  });

  it("callback falhando não impede o webhook", async () => {
    const api = fakeApi({ put: vi.fn(async () => Promise.reject(httpError(503))) });
    const r = await service.setup(123, asAxios(api));
    expect(r.discountCallback).toEqual({ ok: false, error: "HTTP 503" });
    expect(r.uninstallWebhook.ok).toBe(true);
    expect(r.promotion.ok).toBe(true);
  });

  it("erro do getStoreConfig (banco) vira falha só do passo promoção", async () => {
    getStoreConfig.mockRejectedValue(new Error("neon fora"));
    const r = await service.setup(123, asAxios(fakeApi()));
    expect(r.promotion).toEqual({ ok: false, error: "neon fora" });
    expect(r.discountCallback.ok).toBe(true);
  });

  it("mensagem de erro de axios é só o status (não vaza token/URL/body)", async () => {
    const api = fakeApi({ put: vi.fn(async () => Promise.reject(httpError(401))) });
    const r = await service.setup(123, asAxios(api));
    expect(r.discountCallback.error).toBe("HTTP 401");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("erro de rede do axios (sem response) → \"HTTP ?\"", async () => {
    const api = fakeApi({ put: vi.fn(async () => Promise.reject(new AxiosError("socket hang up", "ECONNRESET"))) });
    const r = await service.setup(123, asAxios(api));
    expect(r.discountCallback.error).toBe("HTTP ?");
  });
});

describe("AuthService.ensurePromotion", () => {
  const SAVED = { promotionId: "999", minQuantity: 3, atcStoreType: "all", designOption: 1 };

  it("promotionId salvo e GET promotions/{id} 200 → reaproveita: nenhum POST e nenhum UPDATE", async () => {
    getStoreConfig.mockResolvedValue(SAVED);
    const api = fakeApi();
    await service.ensurePromotion(123, asAxios(api));
    expect(api.get).toHaveBeenCalledWith("promotions/999");
    expect(api.post).not.toHaveBeenCalled();
    expect(f.chains).toHaveLength(0);
  });

  it("promotionId salvo mas GET 404 (promoção apagada) → cria nova e atualiza o id", async () => {
    getStoreConfig.mockResolvedValue(SAVED);
    const api = fakeApi({ get: vi.fn(async () => Promise.reject(httpError(404))) });
    await service.ensurePromotion(123, asAxios(api));
    expect(api.post).toHaveBeenCalledWith("promotions", { name: "Atacado", allocation_type: "cross_items", active: true });
    expect(f.argsOf(0, "set")).toEqual([{ promotionId: "555" }]);
  });

  it.each([
    ["500", () => httpError(500)],
    ["401", () => httpError(401)],
    ["429", () => httpError(429)],
    ["rede (sem response)", () => new AxiosError("socket hang up", "ECONNRESET")],
    ["erro não-axios", () => new Error("bug")],
  ])("promotionId salvo e GET falha com %s → lança, sem POST e sem UPDATE", async (_l, mkErr) => {
    getStoreConfig.mockResolvedValue(SAVED);
    const api = fakeApi({ get: vi.fn(async () => Promise.reject(mkErr())) });
    await expect(service.ensurePromotion(123, asAxios(api))).rejects.toBeDefined();
    expect(api.post).not.toHaveBeenCalled();
    expect(f.chains).toHaveLength(0);
  });

  it("GET 500 na promoção salva → só o passo promoção falha no setup", async () => {
    getStoreConfig.mockResolvedValue(SAVED);
    const api = fakeApi({
      get: vi.fn(async (path: string) => {
        if (path.startsWith("promotions/")) throw httpError(500);
        return { data: [] };
      }),
    });
    const r = await service.setup(123, asAxios(api));
    expect(r).toEqual({ promotion: { ok: false, error: "HTTP 500" }, discountCallback: { ok: true }, uninstallWebhook: { ok: true } });
  });

  it("promotionId vazio (\"\") é tratado como ausente: cria sem GET", async () => {
    getStoreConfig.mockResolvedValue({ ...SAVED, promotionId: "" });
    const api = fakeApi();
    await service.ensurePromotion(123, asAxios(api));
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith("promotions", expect.anything());
  });

  it("sem config (null) → cria a promoção cross_items", async () => {
    getStoreConfig.mockResolvedValue(null);
    const api = fakeApi();
    await service.ensurePromotion(123, asAxios(api));
    expect(api.post).toHaveBeenCalledWith("promotions", { name: "Atacado", allocation_type: "cross_items", active: true });
  });

  it.each([
    ["{ id }", { id: 555 }, "555"],
    ["{ data: { id } }", { data: { id: 777 } }, "777"],
    ["id string", { id: "abc-1" }, "abc-1"],
  ])("resposta %s → salva promotionId como string", async (_l, data, expected) => {
    const api = fakeApi({ post: vi.fn(async () => ({ data })) });
    await service.ensurePromotion(123, asAxios(api));
    expect(f.argsOf(0, "update")).toEqual([storeConfig]);
    expect(f.argsOf(0, "set")).toEqual([{ promotionId: expected }]);
  });

  it.each([[{}], [null], [{ data: {} }], [{ id: null }]])("resposta sem id %j → lança e não grava", async (data) => {
    const api = fakeApi({ post: vi.fn(async () => ({ data })) });
    await expect(service.ensurePromotion(123, asAxios(api))).rejects.toThrow("resposta sem id da promoção");
    expect(f.chains).toHaveLength(0);
  });
});

describe("AuthService.ensureUninstallWebhook", () => {
  it("já existe com mesmo evento e URL → não cria outro", async () => {
    const api = fakeApi({
      get: vi.fn(async () => ({ data: [{ id: 1, event: "app/uninstalled", url: HOOK_URL }] })),
    });
    await service.ensureUninstallWebhook(asAxios(api));
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    ["mesmo evento, URL diferente", [{ event: "app/uninstalled", url: "https://antigo.test/hook" }]],
    ["mesma URL, evento diferente", [{ event: "order/created", url: HOOK_URL }]],
    ["lista vazia", []],
    ["resposta não-array", { webhooks: [] }],
  ])("%s → cria", async (_l, data) => {
    const api = fakeApi({ get: vi.fn(async () => ({ data })) });
    await service.ensureUninstallWebhook(asAxios(api));
    expect(api.post).toHaveBeenCalledWith("webhooks", { event: "app/uninstalled", url: HOOK_URL });
  });

  it("APP_URL com barra final não gera // na URL", async () => {
    const api = fakeApi();
    await service.ensureUninstallWebhook(asAxios(api));
    expect(api.post.mock.calls[0][1].url).toBe(HOOK_URL);
  });

  it("GET webhooks falhando → lança (vira falha do passo)", async () => {
    const api = fakeApi({ get: vi.fn(async () => Promise.reject(httpError(500))) });
    await expect(service.ensureUninstallWebhook(asAxios(api))).rejects.toBeInstanceOf(AxiosError);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("AuthService.adminUrl", () => {
  it("erro na API → null", async () => {
    const api = fakeApi({ get: vi.fn(async () => Promise.reject(httpError(500))) });
    expect(await service.adminUrl(asAxios(api))).toBeNull();
  });

  it.each([[{}], [null], [{ original_domain: "" }]])("sem original_domain %j → null", async (data) => {
    const api = fakeApi({ get: vi.fn(async () => ({ data })) });
    expect(await service.adminUrl(asAxios(api))).toBeNull();
  });

  it("pede só o campo original_domain", async () => {
    const api = fakeApi();
    await service.adminUrl(asAxios(api));
    expect(api.get).toHaveBeenCalledWith("store", { params: { fields: "original_domain" } });
  });
});

describe("GET /api/auth/callback", () => {
  const call = (qs: string) => GET(new Request(`${APP}/api/auth/callback${qs}`));

  beforeEach(() => {
    axiosPost.mockResolvedValue({ data: { access_token: TOKEN, scope: "s", user_id: 123 } });
  });

  async function expectHtml(res: Response, status: number) {
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const text = await res.text();
    expect(text).toMatch(/<!doctype html>/i);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("enc(");
    return text;
  }

  it("com adminUrl → 302 para o admin", async () => {
    nuvemshopClient.mockReturnValue(asAxios(fakeApi()));
    const res = await call("?code=abc");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://loja.lojavirtualnuvem.com.br/admin/apps/4242");
    expect(res.headers.get("location")).not.toContain(TOKEN);
  });

  it("sem adminUrl → 302 para o admin genérico da Nuvemshop (nunca JSON, nunca o token)", async () => {
    nuvemshopClient.mockReturnValue(asAxios(fakeApi({ get: vi.fn(async () => Promise.reject(httpError(500))) })));
    const res = await call("?code=abc");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.nuvemshop.com.br/admin");
    expect(res.headers.get("content-type") ?? "").not.toMatch(/json/);
    expect(await res.text()).not.toContain(TOKEN);
  });

  it("setup falhando inteiro ainda redireciona (install não falha por causa do setup)", async () => {
    const boom = vi.fn(async () => Promise.reject(httpError(500)));
    nuvemshopClient.mockReturnValue(asAxios(fakeApi({ get: boom, post: boom, put: boom })));
    const res = await call("?code=abc");
    expect(res.status).toBe(302);
  });

  it.each(["", "?code=", "?outro=1"])("sem code (%j) → página HTML 400", async (qs) => {
    const text = await expectHtml(await call(qs), 400);
    expect(text).toContain("incompleto");
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it("troca falhando → página HTML 502 sem token", async () => {
    axiosPost.mockRejectedValue(httpError(401));
    await expectHtml(await call("?code=x"), 502);
  });

  it("resposta sem token → página HTML 502", async () => {
    axiosPost.mockResolvedValue({ data: { user_id: 123 } });
    await expectHtml(await call("?code=x"), 502);
  });

  it("erro genérico (banco) → página HTML 500 com x-request-id, sem token nem detalhe do erro", async () => {
    f.queue(new Error(`insert falhou com ${TOKEN} SELECT`));
    const res = await call("?code=x");
    const text = await expectHtml(res, 500);
    const requestId = res.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(text).toContain(requestId!);
    expect(text).not.toContain("SELECT");
  });

  it("ApiError não leva x-request-id", async () => {
    const res = await call("");
    expect(res.headers.get("x-request-id")).toBeNull();
  });

  it("code com HTML/script não é refletido na página de erro", async () => {
    axiosPost.mockRejectedValue(httpError(400));
    const text = await expectHtml(await call(`?code=${encodeURIComponent("<script>alert(1)</script>")}`), 502);
    expect(text).not.toContain("<script>");
  });
});
