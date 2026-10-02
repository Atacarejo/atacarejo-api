import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorBody, internalError, parseId, readJson, withErrors } from "@/lib/http";

describe("parseId", () => {
  it.each([
    ["1", 1],
    ["123", 123],
    [123, 123],
    [1.0, 1],
    ["9007199254740991", 9007199254740991], // MAX_SAFE_INTEGER
    [2 ** 53 - 1, 2 ** 53 - 1],
  ])("%j → %d", (input, expected) => {
    expect(parseId(input)).toBe(expected);
  });

  it.each([
    "007",
    "0",
    "1e3",
    " 1",
    "1 ",
    "+1",
    "-1",
    "1.0",
    "1.5",
    "0x1A",
    "",
    "abc",
    "１２３", // dígitos unicode
    "9007199254740992", // 2**53, 16 dígitos mas não é seguro
    "99999999999999999", // 17 dígitos
    2 ** 53,
    0,
    -1,
    1.5,
    1e21,
    NaN,
    Infinity,
    true,
    false,
    null,
    undefined,
    {},
    [1],
  ])("%j → null", (input) => {
    expect(parseId(input)).toBeNull();
  });

  it("bigint → null", () => {
    expect(parseId(BigInt(1))).toBeNull();
  });
});

describe("withErrors", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const req = new Request("https://api.test/x");

  it("repassa a resposta do handler", async () => {
    const res = await withErrors(async () => Response.json({ ok: 1 }, { status: 201 }))(req, {});
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it.each([400, 401, 404, 409, 502])("ApiError %d → mesmo status e { message, code }", async (status) => {
    const res = await withErrors(async () => {
      throw new ApiError("mensagem esperada", status, "invalid_price");
    })(req, {});
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ message: "mensagem esperada", code: "invalid_price" });
    expect(res.headers.get("x-request-id")).toBeNull();
  });

  it("ApiError com params → { message, code, params }", async () => {
    const res = await withErrors(async () => {
      throw new ApiError("item 3: preço inválido", 400, "invalid_price", { index: 3 });
    })(req, {});
    expect(await res.json()).toEqual({ message: "item 3: preço inválido", code: "invalid_price", params: { index: 3 } });
  });

  it("ApiError guarda status, code e params", () => {
    const err = new ApiError("x", 429, "rate_limited", { max: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("x");
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");
    expect(err.params).toEqual({ max: 1 });
  });

  it("erro genérico → 500 com requestId no body e no header, sem vazar detalhe", async () => {
    const res = await withErrors(async () => {
      throw new Error("token=abc123 SELECT * FROM stores");
    })(req, {});
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("SELECT");
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(["code", "message", "requestId"]);
    expect(body.code).toBe("internal_error");
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("valor não-Error lançado (string/undefined) também vira 500", async () => {
    for (const thrown of ["boom", undefined, { status: 400, message: "parece ApiError" }]) {
      const res = await withErrors(async () => {
        throw thrown;
      })(req, {});
      expect(res.status).toBe(500);
    }
  });

  it("cada 500 tem um requestId diferente", async () => {
    const h = withErrors(async () => {
      throw new Error("x");
    });
    const a = (await (await h(req, {})).json()).requestId;
    const b = (await (await h(req, {})).json()).requestId;
    expect(a).not.toBe(b);
  });

  it("repassa req e ctx ao handler", async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const ctx = { params: Promise.resolve({ id: "1" }) };
    await withErrors(handler)(req, ctx);
    expect(handler).toHaveBeenCalledWith(req, ctx);
  });
});

describe("readJson", () => {
  const post = (body?: string) => new Request("https://api.test/x", { method: "POST", body });

  it("JSON válido → objeto", async () => {
    await expect(readJson(post('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it.each(["{", "nao json", "{'a':1}", ""])("body %j → ApiError 400", async (body) => {
    const err = (await readJson(post(body)).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_json");
  });

  it("sem body → ApiError 400", async () => {
    const err = (await readJson(new Request("https://api.test/x")).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
  });

  it("JSON válido não-objeto (null, número) passa adiante — a validação é do service", async () => {
    await expect(readJson(post("null"))).resolves.toBeNull();
    await expect(readJson(post("5"))).resolves.toBe(5);
  });

  it("dentro do withErrors vira resposta 400", async () => {
    const res = await withErrors(async (r) => Response.json(await readJson(r)))(post("{"), {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "JSON inválido", code: "invalid_json" });
  });
});

describe("internalError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("500 com requestId no body e no header, sem detalhe do erro", async () => {
    const res = internalError(new Error("segredo do banco"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("segredo");
    const body = JSON.parse(text);
    expect(body).toEqual({ message: "erro interno", code: "internal_error", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("preserva headers extras (CORS, Cache-Control)", () => {
    const res = internalError("x", { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("header extra x-request-id não sobrescreve o gerado", async () => {
    const res = internalError("x", { "x-request-id": "forjado" });
    expect(res.headers.get("x-request-id")).not.toBe("forjado");
    expect(res.headers.get("x-request-id")).toBe((await res.json()).requestId);
  });

  it("loga o erro com o requestId (para cruzar com o header)", () => {
    const err = new Error("boom");
    const res = internalError(err);
    expect(console.error).toHaveBeenCalledWith(`[${res.headers.get("x-request-id")}]`, err);
  });
});

describe("errorBody", () => {
  it("sem params → só message e code", () => {
    expect(errorBody("loja não instalada", "store_not_installed")).toEqual({ message: "loja não instalada", code: "store_not_installed" });
  });

  it("com params → inclui params", () => {
    expect(errorBody("máximo", "too_many_items", { max: 1000 })).toEqual({ message: "máximo", code: "too_many_items", params: { max: 1000 } });
  });
});
