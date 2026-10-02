// app/api/wholesale/route.ts
import { ApiError, parseId, readJson, withErrors } from "@/lib/http";
import { requireStoreId } from "@/lib/nexo-auth";
import { listWholesale, MAX_ITEMS, parseWholesaleItems, saveWholesale } from "./wholesale.service";

// GET /api/wholesale?variant_ids=1,2,3 → preços de atacado das variantes (ou de todas)
export const GET = withErrors(async (req) => {
  const storeId = requireStoreId(req);
  const raw = new URL(req.url).searchParams.get("variant_ids");

  let variantIds: number[] | null = null;
  if (raw !== null) {
    const parts = raw.split(",").filter(Boolean);
    if (parts.length > MAX_ITEMS) throw new ApiError(`máximo de ${MAX_ITEMS} variantes`, 400, "too_many_variants", { max: MAX_ITEMS });
    variantIds = parts.map(parseId).filter((id): id is number => id !== null);
    if (variantIds.length === 0) return Response.json([]);
  }

  return Response.json(await listWholesale(storeId, variantIds));
});

// POST /api/wholesale { items: [{ productId, variantId, price }] } — price vazio/0 remove
export const POST = withErrors(async (req) => {
  const storeId = requireStoreId(req);
  const changes = parseWholesaleItems(await readJson(req));
  return Response.json(await saveWholesale(storeId, changes));
});
