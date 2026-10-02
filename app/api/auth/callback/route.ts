// app/api/auth/callback/route.ts
import { ApiError } from "@/lib/http";
import { authService } from "./auth.service";

const SUPPORT_EMAIL = "suporte@nextcubeinc.com";

/** O lojista chega aqui pelo navegador: erro vira uma página legível, nunca JSON cru. */
function errorPage(status: number, message: string): Response {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atacarejo</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#0a0a0a}a{color:#0050c3}</style>
</head><body>
<h1>Não foi possível instalar o app</h1>
<p>${message}</p>
<p>Volte ao admin da Nuvemshop e tente instalar de novo. Se continuar, fale com a gente: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  // a Nuvemshop redireciona para cá com ?code=...
  const code = new URL(req.url).searchParams.get("code") ?? "";

  try {
    const { adminUrl } = await authService.install(code);
    // leva o lojista direto para o app dentro do admin
    if (adminUrl) return Response.redirect(adminUrl, 302);
    return new Response(null, { status: 302, headers: { Location: "https://www.nuvemshop.com.br/admin" } });
  } catch (err) {
    if (err instanceof ApiError) {
      return errorPage(err.status, err.status === 400 ? "O link de instalação está incompleto." : "A Nuvemshop não confirmou a instalação. O código pode ter expirado.");
    }
    const requestId = crypto.randomUUID();
    console.error(`[${requestId}] [install]`, err); // nunca logue o token
    const res = errorPage(500, `Erro interno (código ${requestId}).`);
    res.headers.set("x-request-id", requestId);
    return res;
  }
}
