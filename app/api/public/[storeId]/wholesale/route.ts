// app/api/public/[storeId]/wholesale/route.ts
// GET → [{ product_id, variant_id, price_atc }] com todos os preços de atacado da loja.
import { eq } from "drizzle-orm";
import { wholesalePrices } from "@/db/schema";
import { db } from "@/lib/db";
import { internalError, parseId } from "@/lib/http";
import { PUBLIC_HEADERS, preflight } from "../../public";

export async function GET(_req: Request, ctx: { params: Promise<{ storeId: string }> }) {
  const storeId = parseId((await ctx.params).storeId);
  if (storeId === null) {
    return Response.json({ message: "storeId inválido" }, { status: 400, headers: PUBLIC_HEADERS });
  }

  try {
    const rows = await db
      .select({
        product_id: wholesalePrices.productId,
        variant_id: wholesalePrices.variantId,
        price_atc: wholesalePrices.price,
      })
      .from(wholesalePrices)
      .where(eq(wholesalePrices.storeId, storeId));
    return Response.json(rows, { headers: PUBLIC_HEADERS });
  } catch (err) {
    return internalError(err, { ...PUBLIC_HEADERS, "Cache-Control": "no-store" });
  }
}

export const OPTIONS = preflight;
