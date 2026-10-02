// app/api/public/[storeId]/config/route.ts
// GET → { min_quantity, atc_store_type, design_option }. Nunca falha: em erro devolve os padrões.
import { DEFAULT_DESIGN_OPTION, isDesignOption } from "@/lib/design-options";
import { parseId } from "@/lib/http";
import { DEFAULT_CONFIG, getStoreConfig } from "@/lib/store-config";
import { PUBLIC_HEADERS, preflight } from "../../public";

export async function GET(_req: Request, ctx: { params: Promise<{ storeId: string }> }) {
  const storeId = parseId((await ctx.params).storeId);

  let config = DEFAULT_CONFIG;
  let failed = false;
  if (storeId !== null) {
    try {
      config = (await getStoreConfig(storeId)) ?? DEFAULT_CONFIG;
    } catch (err) {
      console.error("[public/config]", err);
      failed = true;
    }
  }

  // modelo removido ou desconhecido vira o padrão: o SDK só recebe modelos que existem
  const designOption = isDesignOption(config.designOption) ? config.designOption : DEFAULT_DESIGN_OPTION;

  return Response.json(
    { min_quantity: config.minQuantity, atc_store_type: config.atcStoreType, design_option: designOption },
    // o padrão por erro não pode ficar no cache da CDN
    { headers: failed ? { ...PUBLIC_HEADERS, "Cache-Control": "no-store" } : PUBLIC_HEADERS },
  );
}

export const OPTIONS = preflight;
