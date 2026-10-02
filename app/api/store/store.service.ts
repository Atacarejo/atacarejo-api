// app/api/store/store.service.ts
import { nuvemshopApiError, nuvemshopClientFor } from "@/lib/nuvemshop";
import { STORE_INFO_FIELDS, type StoreInfo, toStoreInfo } from "@/lib/store-info";

/** Idioma, país e moeda da loja (GET /store da Nuvemshop) para o admin se adaptar à região. */
export async function getStoreInfo(storeId: number): Promise<StoreInfo> {
  const api = await nuvemshopClientFor(storeId);
  let data: unknown;
  try {
    ({ data } = await api.get("store", { params: { fields: STORE_INFO_FIELDS.join(",") } }));
  } catch (err) {
    throw nuvemshopApiError(err, "falha ao buscar a loja na Nuvemshop");
  }
  return toStoreInfo(data);
}
