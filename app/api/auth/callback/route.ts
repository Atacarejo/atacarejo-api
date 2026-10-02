// app/api/auth/callback/route.ts
import { ApiError } from "@/lib/http";
import { type Locale, localeFromAcceptLanguage } from "@/lib/locale";
import { authService } from "./auth.service";

const SUPPORT_EMAIL = "suporte@nextcubeinc.com";

// a loja ainda não é conhecida quando a instalação falha: o idioma vem do navegador do lojista
const PAGE_TEXT: Record<
  Locale,
  { lang: string; title: string; incomplete: string; notConfirmed: string; internal: (id: string) => string; retry: string }
> = {
  pt: {
    lang: "pt-BR",
    title: "Não foi possível instalar o app",
    incomplete: "O link de instalação está incompleto.",
    notConfirmed: "A Nuvemshop não confirmou a instalação. O código pode ter expirado.",
    internal: (id) => `Erro interno (código ${id}).`,
    retry: "Volte ao admin da Nuvemshop e tente instalar de novo. Se continuar, fale com a gente:",
  },
  es: {
    lang: "es",
    title: "No se pudo instalar la app",
    incomplete: "El enlace de instalación está incompleto.",
    notConfirmed: "Tiendanube no confirmó la instalación. Es posible que el código haya expirado.",
    internal: (id) => `Error interno (código ${id}).`,
    retry: "Vuelve al administrador de Tiendanube e intenta instalarla de nuevo. Si continúa, escríbenos:",
  },
  en: {
    lang: "en",
    title: "The app could not be installed",
    incomplete: "The installation link is incomplete.",
    notConfirmed: "The platform did not confirm the installation. The code may have expired.",
    internal: (id) => `Internal error (code ${id}).`,
    retry: "Go back to your store admin and try installing again. If it keeps happening, contact us:",
  },
};

/** O lojista chega aqui pelo navegador: erro vira uma página legível, nunca JSON cru. */
function errorPage(status: number, locale: Locale, message: string): Response {
  const t = PAGE_TEXT[locale];
  const html = `<!doctype html>
<html lang="${t.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atacarejo</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#0a0a0a}a{color:#0050c3}</style>
</head><body>
<h1>${t.title}</h1>
<p>${message}</p>
<p>${t.retry} <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  // a Nuvemshop redireciona para cá com ?code=...
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const locale = localeFromAcceptLanguage(req.headers.get("accept-language"));
  const t = PAGE_TEXT[locale];

  try {
    const { adminUrl } = await authService.install(code);
    // leva o lojista direto para o app dentro do admin
    if (adminUrl) return Response.redirect(adminUrl, 302);
    return new Response(null, { status: 302, headers: { Location: "https://www.nuvemshop.com.br/admin" } });
  } catch (err) {
    if (err instanceof ApiError) {
      return errorPage(err.status, locale, err.status === 400 ? t.incomplete : t.notConfirmed);
    }
    const requestId = crypto.randomUUID();
    console.error(`[${requestId}] [install]`, err); // nunca logue o token
    const res = errorPage(500, locale, t.internal(requestId));
    res.headers.set("x-request-id", requestId);
    return res;
  }
}
