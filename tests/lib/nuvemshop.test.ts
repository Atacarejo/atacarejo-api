import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "@/db/schema";
import { ApiError } from "@/lib/http";
import type { FakeDb } from "@/tests/helpers/fake-db";

const { db, fake } = await vi.hoisted(async () => (await import("@/tests/helpers/fake-db")).createFakeDb());
vi.mock("@/lib/db", () => ({ db }));

const decrypt = vi.hoisted(() => vi.fn((s: string) => `plain:${s}`));
vi.mock("@/lib/crypto", () => ({ decrypt, encrypt: vi.fn() }));

import { nuvemshopApiError, nuvemshopClient, nuvemshopClientFor, userAgent } from "@/lib/nuvemshop";

const f = fake as FakeDb;

type Reply = { status: number; headers?: Record<string, string>; data?: unknown } | Error;

/** Adapter fake do axios: responde com a fila `replies`, na ordem; 4xx/5xx rejeitam como o axios real. */
function fakeAdapter(replies: Reply[]) {
  return vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const r = replies.shift() ?? { status: 200 };
    if (r instanceof Error) throw new AxiosError(r.message, "ECONNRESET", config);
    const response: AxiosResponse = {
      status: r.status,
      statusText: String(r.status),
      headers: new AxiosHeaders(r.headers ?? {}),
      data: r.data ?? { ok: true },
      config,
    };
    if (r.status >= 400) throw new AxiosError(`status ${r.status}`, "ERR_BAD_REQUEST", config, null, response);
    return response;
  });
}

function client(replies: Reply[]) {
  const c = nuvemshopClient(123, "tok_abc");
  const adapter = fakeAdapter(replies);
  c.defaults.adapter = adapter;
  return { c, adapter };
}

beforeEach(() => {
  f.reset();
  decrypt.mockClear();
  vi.stubEnv("NUVEMSHOP_API_URL", "https://api.nuvemshop.test/v1//");
  vi.stubEnv("CLIENT_ID", "4242");
});

describe("nuvemshopClient — configuração", () => {
  it("baseURL /{storeId}/ sem barras duplicadas e timeout de 10 s", () => {
    const c = nuvemshopClient(123, "tok_abc");
    expect(c.defaults.baseURL).toBe("https://api.nuvemshop.test/v1/123/");
    expect(c.defaults.timeout).toBe(10_000);
  });

  it("manda só Authorization: Bearer <token> (sem o header Authentication antigo), User-Agent e JSON", async () => {
    const { c, adapter } = client([{ status: 200 }]);
    await c.get("store");
    const headers = adapter.mock.calls[0][0].headers;
    expect(headers.get("Authorization")).toBe("Bearer tok_abc");
    expect(headers.has("Authentication")).toBe(false);
    expect(headers.get("User-Agent")).toBe("Atacarejo/4242 (suporte@nextcubeinc.com)");
    expect(headers.get("Content-Type")).toMatch(/application\/json/);
    expect(adapter.mock.calls[0][0].url).toBe("store");
  });

  it("retry em 429 reenvia o mesmo User-Agent", async () => {
    vi.useFakeTimers();
    try {
      const { c, adapter } = client([{ status: 429, headers: { "x-rate-limit-reset": "1" } }, { status: 200 }]);
      const p = c.get("store");
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(adapter.mock.calls[1][0].headers.get("User-Agent")).toBe("Atacarejo/4242 (suporte@nextcubeinc.com)");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("userAgent", () => {
  it("com CLIENT_ID → nome do app/app id + e-mail de contato", () => {
    vi.stubEnv("CLIENT_ID", "4242");
    expect(userAgent()).toBe("Atacarejo/4242 (suporte@nextcubeinc.com)");
  });

  it("CLIENT_ID com espaços nas pontas é aparado", () => {
    vi.stubEnv("CLIENT_ID", " 4242 \n");
    expect(userAgent()).toBe("Atacarejo/4242 (suporte@nextcubeinc.com)");
  });

  it.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["só espaços", "   "],
  ])("CLIENT_ID %s → só nome do app + e-mail", (_l, value) => {
    vi.stubEnv("CLIENT_ID", value as string);
    expect(userAgent()).toBe("Atacarejo (suporte@nextcubeinc.com)");
  });

  it.each([["quebra de linha", "42\r\nX-Evil: 1"], ["espaço no meio", "42 43"], ["parênteses", "42)"]])(
    "CLIENT_ID com %s (quebraria o header) → ignorado",
    (_l, value) => {
      vi.stubEnv("CLIENT_ID", value);
      expect(userAgent()).toBe("Atacarejo (suporte@nextcubeinc.com)");
    },
  );

  it("o client usa o CLIENT_ID do momento em que é criado", async () => {
    vi.stubEnv("CLIENT_ID", "");
    const { c, adapter } = client([{ status: 200 }]);
    await c.get("store");
    expect(adapter.mock.calls[0][0].headers.get("User-Agent")).toBe("Atacarejo (suporte@nextcubeinc.com)");
  });
});

describe("nuvemshopApiError", () => {
  const axiosErr = (status?: number) =>
    new AxiosError(
      "x",
      "ERR",
      undefined,
      undefined,
      status === undefined
        ? undefined
        : { status, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: {} },
    );

  it("429 → ApiError 429 rate_limited", () => {
    const err = nuvemshopApiError(axiosErr(429), "falhou");
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.code]).toEqual([429, "rate_limited"]);
  });

  it("401 → ApiError 401 invalid_token", () => {
    const err = nuvemshopApiError(axiosErr(401), "falhou");
    expect([err.status, err.code]).toEqual([401, "invalid_token"]);
  });

  it.each([
    ["500", axiosErr(500)],
    ["403", axiosErr(403)],
    ["404", axiosErr(404)],
    ["rede (sem response)", axiosErr()],
    ["erro não-axios", new Error("bug")],
    ["valor não-Error", "x"],
  ])("%s → ApiError 502 nuvemshop_unavailable com a mensagem informada", (_l, e) => {
    const err = nuvemshopApiError(e, "falha ao buscar a loja");
    expect([err.status, err.code, err.message]).toEqual([502, "nuvemshop_unavailable", "falha ao buscar a loja"]);
  });
});

describe("nuvemshopClient — retry em 429", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("429 e depois 200 → resolve com a 2ª resposta, esperando x-rate-limit-reset", async () => {
    const { c, adapter } = client([{ status: 429, headers: { "x-rate-limit-reset": "300" } }, { status: 200, data: { id: 1 } }]);
    const p = c.get("products");
    await vi.advanceTimersByTimeAsync(299);
    expect(adapter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const res = await p;
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: 1 });
  });

  it("retry repete método, url e body", async () => {
    const { c, adapter } = client([{ status: 429, headers: { "x-rate-limit-reset": "10" } }, { status: 201 }]);
    const p = c.post("promotions", { name: "Atacado" });
    await vi.advanceTimersByTimeAsync(10);
    await p;
    const [first, second] = adapter.mock.calls.map((call) => call[0]);
    expect(second.method).toBe(first.method);
    expect(second.url).toBe("promotions");
    expect(second.data).toBe(first.data);
    expect(second.headers.get("Authorization")).toBe("Bearer tok_abc");
  });

  it("espera no máximo 2 s mesmo se o reset for maior", async () => {
    const { c, adapter } = client([{ status: 429, headers: { "x-rate-limit-reset": "60000" } }, { status: 200 }]);
    const p = c.get("products");
    await vi.advanceTimersByTimeAsync(1999);
    expect(adapter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["ausente", undefined],
    ["texto", "abc"],
    ["zero", "0"],
    ["negativo", "-5"],
  ])("reset %s → espera 500 ms × tentativa", async (_l, reset) => {
    const headers: Record<string, string> = reset === undefined ? {} : { "x-rate-limit-reset": reset };
    const { c, adapter } = client([{ status: 429, headers }, { status: 429, headers }, { status: 200 }]);
    const p = c.get("products");
    await vi.advanceTimersByTimeAsync(499);
    expect(adapter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(adapter).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter).toHaveBeenCalledTimes(3);
    expect((await p).status).toBe(200);
  });

  it("no máximo 2 retries: 3 × 429 → rejeita com o 429 (3 chamadas no total)", async () => {
    const r429 = { status: 429, headers: { "x-rate-limit-reset": "100" } };
    const { c, adapter } = client([r429, r429, r429, { status: 200 }]);
    const p = c.get("products").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = (await p) as AxiosError;
    expect(err).toBeInstanceOf(AxiosError);
    expect(err.response?.status).toBe(429);
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it("contador de retries é por requisição (outra requisição tem suas próprias tentativas)", async () => {
    const r429 = { status: 429, headers: { "x-rate-limit-reset": "10" } };
    const { c, adapter } = client([r429, r429, { status: 200 }, r429, r429, { status: 200 }]);
    const p1 = c.get("a");
    await vi.advanceTimersByTimeAsync(100);
    expect((await p1).status).toBe(200);
    const p2 = c.get("b");
    await vi.advanceTimersByTimeAsync(100);
    expect((await p2).status).toBe(200);
    expect(adapter).toHaveBeenCalledTimes(6);
  });

  it.each([400, 401, 404, 500, 503])("status %d não tem retry", async (status) => {
    const { c, adapter } = client([{ status, headers: { "x-rate-limit-reset": "10" } }, { status: 200 }]);
    const err = (await c.get("x").catch((e: unknown) => e)) as AxiosError;
    expect(err.response?.status).toBe(status);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("erro de rede (sem response) não tem retry", async () => {
    const { c, adapter } = client([new Error("socket hang up"), { status: 200 }]);
    await expect(c.get("x")).rejects.toBeInstanceOf(AxiosError);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("clientes diferentes não compartilham o interceptor", async () => {
    const a = client([{ status: 404 }]);
    const b = client([{ status: 404 }]);
    await a.c.get("x").catch(() => {});
    await b.c.get("x").catch(() => {});
    expect(a.adapter).toHaveBeenCalledTimes(1);
    expect(b.adapter).toHaveBeenCalledTimes(1);
  });
});

describe("nuvemshopClientFor", () => {
  it("loja sem linha em stores → ApiError 401", async () => {
    f.queue([]);
    const err = (await nuvemshopClientFor(123).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("store_not_installed");
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("loja encontrada → client com o token descriptografado", async () => {
    f.queue([{ accessToken: "cifrado" }]);
    const c = await nuvemshopClientFor(123);
    expect(f.argsOf(0, "from")).toEqual([stores]);
    expect(decrypt).toHaveBeenCalledWith("cifrado");
    expect(c.defaults.baseURL).toBe("https://api.nuvemshop.test/v1/123/");
    expect((c.defaults.headers as unknown as Record<string, unknown>).Authorization).toBe("Bearer plain:cifrado");
  });

  it("decrypt lançando (chave errada) propaga", async () => {
    f.queue([{ accessToken: "cifrado" }]);
    decrypt.mockImplementationOnce(() => {
      throw new Error("bad decrypt");
    });
    await expect(nuvemshopClientFor(123)).rejects.toThrow("bad decrypt");
  });
});
