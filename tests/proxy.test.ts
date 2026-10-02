// a doc do Next 16 cita unstable_doesProxyMatch, mas o pacote instalado só exporta o nome antigo
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";

const FRONT = "https://admin.atacarejo.test";

function request(path: string, opts: { method?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin) headers.origin = opts.origin;
  return new NextRequest(`https://api.test${path}`, { method: opts.method ?? "GET", headers });
}

beforeEach(() => {
  vi.stubEnv("FRONT_URL", FRONT);
});

describe("proxy — preflight das rotas do admin", () => {
  it.each(["/api/products", "/api/wholesale", "/api/config", "/api/setup", "/api/products/123"])(
    "OPTIONS %s de origem permitida → 204 com headers de CORS",
    (path) => {
      const res = proxy(request(path, { method: "OPTIONS", origin: FRONT }));
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(FRONT);
      expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, OPTIONS");
      expect(res.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type");
      expect(res.headers.get("access-control-max-age")).toBe("600");
      expect(res.headers.get("vary")).toMatch(/Origin/);
    },
  );

  it.each([
    ["outra origem", "https://evil.test"],
    ["subdomínio da origem", "https://x.admin.atacarejo.test"],
    ["origem como prefixo", `${FRONT}.evil.test`],
    ["http em vez de https", FRONT.replace("https", "http")],
    ["origem com barra final", `${FRONT}/`],
    ["origem \"null\"", "null"],
  ])("OPTIONS de %s → 403 sem ACAO", (_l, origin) => {
    const res = proxy(request("/api/products", { method: "OPTIONS", origin }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("403 do preflight também leva Vary: Origin e headers de segurança", () => {
    const res = proxy(request("/api/setup", { method: "OPTIONS", origin: "https://evil.test" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("vary")).toMatch(/Origin/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("/api/setupX não é rota do admin", () => {
    const res = proxy(request("/api/setupX", { method: "OPTIONS", origin: FRONT }));
    expect(res.status).not.toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("OPTIONS sem Origin → 403", () => {
    const res = proxy(request("/api/products", { method: "OPTIONS" }));
    expect(res.status).toBe(403);
  });

  it("FRONT_URL vazio → nenhuma origem é permitida", () => {
    vi.stubEnv("FRONT_URL", "");
    const res = proxy(request("/api/products", { method: "OPTIONS", origin: FRONT }));
    expect(res.status).toBe(403);
  });

  it("FRONT_URL com barra final ainda aceita a origem (sem barra) do navegador", () => {
    vi.stubEnv("FRONT_URL", `${FRONT}/`);
    const res = proxy(request("/api/config", { method: "OPTIONS", origin: FRONT }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(FRONT);
  });

  it("FRONT_URL com várias origens separadas por vírgula e espaços", () => {
    vi.stubEnv("FRONT_URL", ` https://a.test/ ,${FRONT}, ,`);
    for (const origin of ["https://a.test", FRONT]) {
      const res = proxy(request("/api/wholesale", { method: "OPTIONS", origin }));
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });
});

describe("proxy — requisições normais", () => {
  it("GET do admin de origem permitida → segue com CORS e headers de segurança", () => {
    const res = proxy(request("/api/products", { origin: FRONT }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("access-control-allow-origin")).toBe(FRONT);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each([["sem Origin", undefined], ["origem não permitida", "https://evil.test"]])(
    "GET do admin %s → Vary: Origin mesmo sem CORS (CDN não mistura origens)",
    (_l, origin) => {
      const res = proxy(request("/api/config", { origin }));
      expect(res.headers.get("vary")).toMatch(/Origin/);
    },
  );

  it("rota fora do admin não recebe Vary: Origin", () => {
    const res = proxy(request("/api/public/1/config", { origin: FRONT }));
    expect(res.headers.get("vary")).toBeNull();
  });

  it("POST /api/setup de origem permitida → CORS do admin", () => {
    const res = proxy(request("/api/setup", { method: "POST", origin: FRONT }));
    expect(res.headers.get("access-control-allow-origin")).toBe(FRONT);
  });

  it("GET do admin de origem não permitida → segue sem ACAO (o navegador bloqueia)", () => {
    const res = proxy(request("/api/products", { origin: "https://evil.test" }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each(["/api/public/1/config", "/api/public/1/wholesale", "/api/callbacks/discounts", "/api/webhooks/app-uninstalled"])(
    "rota fora do admin %s não recebe o CORS do admin (nem em OPTIONS)",
    (path) => {
      for (const method of ["GET", "OPTIONS"]) {
        const res = proxy(request(path, { method, origin: FRONT }));
        expect(res.status).not.toBe(403);
        expect(res.headers.get("x-middleware-next")).toBe("1");
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      }
    },
  );

  it.each(["/api/productsX", "/api/configuration", "/api/wholesale-legacy"])(
    "%s (só começa igual ao prefixo) não é rota do admin",
    (path) => {
      const res = proxy(request(path, { method: "OPTIONS", origin: FRONT }));
      expect(res.status).not.toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    },
  );
});

describe("proxy — matcher", () => {
  it.each([
    ["/api/products", true],
    ["/api/public/1/config", true],
    ["/api", true], // :path* casa zero segmentos
    ["/", false],
    ["/favicon.ico", false],
  ])("%s → roda o proxy? %s", (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(expected);
  });
});
