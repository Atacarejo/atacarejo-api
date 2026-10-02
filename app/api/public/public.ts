// app/api/public/public.ts
// Endpoints públicos lidos pela vitrine (NubeSDK e script legado). Não expõem nada sensível,
// mas mudar o formato quebra a vitrine — o contrato (snake_case, price_atc) é o mesmo do app antigo.

export const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // cache curto na CDN da Vercel: alivia o banco; alteração no admin aparece em até ~1 min
  "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
};

export function preflight() {
  return new Response(null, { status: 204, headers: { ...PUBLIC_HEADERS, "Access-Control-Max-Age": "86400" } });
}
