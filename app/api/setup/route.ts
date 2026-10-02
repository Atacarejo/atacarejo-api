// app/api/setup/route.ts
// Refaz a configuração da loja na Nuvemshop (promoção, callback, webhook) quando algum passo
// do install falhou. O admin chama isso quando GET /api/config devolve ready: false.
import { withErrors } from "@/lib/http";
import { requireStoreId } from "@/lib/nexo-auth";
import { nuvemshopClientFor } from "@/lib/nuvemshop";
import { authService } from "../auth/callback/auth.service";

export const POST = withErrors(async (req) => {
  const storeId = requireStoreId(req);
  const setup = await authService.setup(storeId, await nuvemshopClientFor(storeId));
  const ready = Object.values(setup).every((s) => s.ok);
  // só ok/falhou por passo: o detalhe do erro fica no log, não vai para o navegador
  const steps = Object.fromEntries(Object.entries(setup).map(([step, r]) => [step, r.ok]));
  return Response.json({ ready, steps }, { status: ready ? 200 : 502 });
});
