// app/api/products/route.ts
import { withErrors } from "@/lib/http";
import { requireStoreId } from "@/lib/nexo-auth";
import { listProducts } from "./products.service";

export const GET = withErrors(async (req) => {
  const storeId = requireStoreId(req);
  const params = new URL(req.url).searchParams;

  const page = Math.max(1, Math.min(10_000, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const q = (params.get("q") ?? "").trim().slice(0, 100);

  return Response.json(await listProducts(storeId, page, q));
});
