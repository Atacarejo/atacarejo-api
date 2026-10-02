// proxy.ts (o antigo middleware.ts — renomeado no Next 16)
// CORS das rotas do admin + headers de segurança em toda a API.
// Rotas públicas, callbacks e webhooks cuidam do próprio CORS (ou não precisam).

import { NextResponse, type NextRequest } from "next/server";

// URL da API aberta direto na barra de endereço vai para o site (como no app antigo)
const SITE_URL = "https://nextcubeinc.com";
// navegação legítima: instalação/OAuth da Nuvemshop
const NAVIGATION_PREFIXES = ["/api/auth"];

// rotas chamadas pelo front do admin (atacarejo-front-web)
const ADMIN_PREFIXES = ["/api/products", "/api/wholesale", "/api/config", "/api/setup", "/api/store"];

function allowedOrigins(): string[] {
  return (process.env.FRONT_URL ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
  };
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // só o navegador manda sec-fetch-mode: fetch do admin/loja é "cors"; webhooks e callbacks não mandam
  if (
    req.headers.get("sec-fetch-mode") === "navigate" &&
    !NAVIGATION_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.redirect(SITE_URL);
  }

  const origin = req.headers.get("origin");
  const isAdmin = ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const cors = isAdmin && origin && allowedOrigins().includes(origin) ? corsHeaders(origin) : null;

  // preflight do navegador
  const res =
    isAdmin && req.method === "OPTIONS" ? new NextResponse(null, { status: cors ? 204 : 403 }) : NextResponse.next();

  if (cors) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  // a resposta muda conforme a origem: a CDN não pode reaproveitar entre origens
  if (isAdmin) res.headers.set("Vary", "Origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
