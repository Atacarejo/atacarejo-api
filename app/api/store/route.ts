// app/api/store/route.ts
// GET → { language: "pt" | "es" | "en", country, currency } da loja do session token.
import { withErrors } from "@/lib/http";
import { requireStoreId } from "@/lib/nexo-auth";
import { getStoreInfo } from "./store.service";

export const GET = withErrors(async (req) => {
  const storeId = requireStoreId(req);
  return Response.json(await getStoreInfo(storeId));
});
