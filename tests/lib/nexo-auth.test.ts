import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";
import { requireStoreId, verifySessionToken } from "@/lib/nexo-auth";

const SECRET = "segredo-de-teste";
const NOW = 1_700_000_000;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** Monta um JWT HS256 de verdade (ou com outro header) assinado com `secret`. */
function jwt(payload: unknown, opts: { secret?: string; header?: unknown; rawPayload?: string } = {}) {
  const h = b64(JSON.stringify("header" in opts ? opts.header : { alg: "HS256", typ: "JWT" }));
  const p = opts.rawPayload ?? b64(JSON.stringify(payload));
  const sig = createHmac("sha256", opts.secret ?? SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

const valid = (extra: Record<string, unknown> = {}) => jwt({ storeId: 123, exp: NOW + 60, ...extra });

describe("verifySessionToken", () => {
  it("token válido → storeId", () => {
    expect(verifySessionToken(valid(), SECRET, NOW)).toBe(123);
  });

  it("segredo errado → null", () => {
    expect(verifySessionToken(jwt({ storeId: 123 }, { secret: "outro" }), SECRET, NOW)).toBeNull();
  });

  it("segredo vazio → null (mesmo com token assinado com segredo vazio)", () => {
    expect(verifySessionToken(jwt({ storeId: 123 }, { secret: "" }), "", NOW)).toBeNull();
  });

  it("alg none sem assinatura → null", () => {
    const h = b64(JSON.stringify({ alg: "none", typ: "JWT" }));
    const p = b64(JSON.stringify({ storeId: 123 }));
    expect(verifySessionToken(`${h}.${p}.`, SECRET, NOW)).toBeNull();
  });

  it("alg none com assinatura HS256 válida → null (alg é fixo)", () => {
    expect(verifySessionToken(jwt({ storeId: 123 }, { header: { alg: "none" } }), SECRET, NOW)).toBeNull();
  });

  it.each(["HS512", "hs256", "RS256", ""])("alg %j → null", (alg) => {
    expect(verifySessionToken(jwt({ storeId: 123 }, { header: { alg } }), SECRET, NOW)).toBeNull();
  });

  it("header sem alg → null", () => {
    expect(verifySessionToken(jwt({ storeId: 123 }, { header: { typ: "JWT" } }), SECRET, NOW)).toBeNull();
  });

  it("payload adulterado (storeId trocado) → null", () => {
    const [h, , s] = valid().split(".");
    const forged = b64(JSON.stringify({ storeId: 999, exp: NOW + 60 }));
    expect(verifySessionToken(`${h}.${forged}.${s}`, SECRET, NOW)).toBeNull();
  });

  it("assinatura truncada / vazia → null", () => {
    const [h, p, s] = valid().split(".");
    expect(verifySessionToken(`${h}.${p}.${s.slice(0, -2)}`, SECRET, NOW)).toBeNull();
    expect(verifySessionToken(`${h}.${p}.`, SECRET, NOW)).toBeNull();
  });

  it("exp == now já está expirado", () => {
    expect(verifySessionToken(jwt({ storeId: 123, exp: NOW }), SECRET, NOW)).toBeNull();
  });

  it("exp no passado → null; exp = now + 1 → válido", () => {
    expect(verifySessionToken(jwt({ storeId: 123, exp: NOW - 1 }), SECRET, NOW)).toBeNull();
    expect(verifySessionToken(jwt({ storeId: 123, exp: NOW + 1 }), SECRET, NOW)).toBe(123);
  });

  it("nbf no futuro → null; nbf == now → válido", () => {
    expect(verifySessionToken(jwt({ storeId: 123, nbf: NOW + 1, exp: NOW + 60 }), SECRET, NOW)).toBeNull();
    expect(verifySessionToken(jwt({ storeId: 123, nbf: NOW, exp: NOW + 60 }), SECRET, NOW)).toBe(123);
  });

  it("usa o relógio real quando `now` não é passado", () => {
    const real = Math.floor(Date.now() / 1000);
    expect(verifySessionToken(jwt({ storeId: 1, exp: real - 5 }), SECRET)).toBeNull();
    expect(verifySessionToken(jwt({ storeId: 1, exp: real + 300 }), SECRET)).toBe(1);
  });

  it("storeId ausente → null", () => {
    expect(verifySessionToken(jwt({ exp: NOW + 60 }), SECRET, NOW)).toBeNull();
  });

  it("storeId como string numérica \"123\" → 123", () => {
    expect(verifySessionToken(valid({ storeId: "123" }), SECRET, NOW)).toBe(123);
  });

  it.each(["0", "-1", "1e3", 1.5, 0, -1, "", "abc", null, true, 2 ** 53, { id: 1 }])("storeId %j → null", (storeId) => {
    expect(verifySessionToken(valid({ storeId }), SECRET, NOW)).toBeNull();
  });

  it.each([
    ["header não é base64/JSON", "!!!.e30.sig"],
    ["payload não é JSON", `${b64('{"alg":"HS256"}')}.${b64("{nao json")}.abc`],
    ["vazio", ""],
    ["2 partes", "a.b"],
    ["4 partes", `${valid()}.extra`],
    ["só pontos", ".."],
  ])("malformado (%s) → null sem lançar", (_label, token) => {
    expect(() => verifySessionToken(token, SECRET, NOW)).not.toThrow();
    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it("payload assinado que não é objeto (número/string) → null", () => {
    expect(verifySessionToken(jwt(42), SECRET, NOW)).toBeNull();
    expect(verifySessionToken(jwt("123"), SECRET, NOW)).toBeNull();
  });

  // BUG: payload `null` com assinatura válida passa do JSON.parse e quebra em `payload.exp`
  // (TypeError) em vez de devolver null; em requireStoreId isso vira 500 em vez de 401.
  it("payload assinado `null` → null sem lançar", () => {
    expect(verifySessionToken(jwt(null), SECRET, NOW)).toBeNull();
  });

  it("header JSON `null` → null", () => {
    expect(verifySessionToken(jwt({ storeId: 1 }, { header: null }), SECRET, NOW)).toBeNull();
  });
});

describe("requireStoreId", () => {
  beforeEach(() => {
    vi.stubEnv("CLIENT_SECRET", SECRET);
  });

  const req = (authorization?: string) =>
    new Request("https://api.test/api/config", { headers: authorization === undefined ? {} : { authorization } });

  const expect401 = (r: Request) => {
    try {
      requireStoreId(r);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      return;
    }
    throw new Error("deveria ter lançado 401");
  };

  // tokens sem exp (o requireStoreId usa o relógio real)
  const token = () => jwt({ storeId: 55, exp: Math.floor(Date.now() / 1000) + 300 });

  it("Bearer válido → storeId", () => {
    expect(requireStoreId(req(`Bearer ${token()}`))).toBe(55);
  });

  it("header ausente → 401", () => expect401(req()));
  it("header vazio → 401", () => expect401(req("")));
  it("só \"Bearer\" → 401", () => expect401(req("Bearer")));
  it("\"Bearer \" + espaços → 401", () => expect401(req("Bearer    ")));
  it("Basic → 401", () => expect401(req(`Basic ${Buffer.from("a:b").toString("base64")}`)));
  it("token sem esquema → 401", () => expect401(req(token())));
  it("token inválido → 401", () => expect401(req("Bearer abc.def.ghi")));

  it("\"bearer\" minúsculo é aceito (esquema é case-insensitive)", () => {
    expect(requireStoreId(req(`bearer ${token()}`))).toBe(55);
  });

  it("espaços extras entre o esquema e o token e no fim são tolerados", () => {
    // o fetch/Headers já remove espaços das pontas do valor
    expect(requireStoreId(req(`Bearer    ${token()}   `))).toBe(55);
  });

  it("CLIENT_SECRET ausente → 401 (não aceita token assinado com segredo vazio)", () => {
    vi.stubEnv("CLIENT_SECRET", "");
    expect401(req(`Bearer ${jwt({ storeId: 55 }, { secret: "" })}`));
  });

  it("token expirado → 401", () => {
    expect401(req(`Bearer ${jwt({ storeId: 55, exp: Math.floor(Date.now() / 1000) - 1 })}`));
  });
});

describe("verifySessionToken — exp obrigatório", () => {
  it("token sem exp → null (nunca expiraria)", () => {
    expect(verifySessionToken(jwt({ storeId: 1 }), SECRET, NOW)).toBeNull();
  });
  it("exp não numérico → null", () => {
    expect(verifySessionToken(jwt({ storeId: 1, exp: String(NOW + 60) }), SECRET, NOW)).toBeNull();
  });
});
