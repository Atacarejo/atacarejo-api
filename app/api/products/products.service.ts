// app/api/products/products.service.ts
import axios from "axios";
import { ApiError } from "@/lib/http";
import { nuvemshopClientFor } from "@/lib/nuvemshop";

export const PER_PAGE = 50;

type I18n = Record<string, string> | string | null | undefined;

type NuvemshopProduct = {
  id: number;
  name: I18n;
  images?: { src: string }[];
  variants?: {
    id: number;
    price: string | null;
    sku: string | null;
    stock: number | null;
    values?: I18n[];
  }[];
};

export type ProductDTO = {
  id: number;
  name: string;
  image: string | null;
  variants: { id: number; name: string; price: string | null; sku: string | null; stock: number | null }[];
};

/** Nome traduzido: pt → es → primeiro idioma disponível. */
export function pickName(value: I18n): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.pt ?? value.es ?? Object.values(value)[0] ?? "";
}

export function toProductDTO(p: NuvemshopProduct): ProductDTO {
  return {
    id: p.id,
    name: pickName(p.name),
    image: p.images?.[0]?.src ?? null,
    variants: (p.variants ?? []).map((v) => ({
      id: v.id,
      name: (v.values ?? []).map(pickName).filter(Boolean).join(" / ") || v.sku || `#${v.id}`,
      price: v.price,
      sku: v.sku,
      stock: v.stock,
    })),
  };
}

export async function listProducts(storeId: number, page: number, q: string) {
  const api = await nuvemshopClientFor(storeId);
  try {
    const res = await api.get<NuvemshopProduct[]>("products", {
      params: { page, per_page: PER_PAGE, fields: "id,name,images,variants", ...(q ? { q } : {}) },
    });
    const total = Number(res.headers["x-total-count"] ?? 0);
    return { products: res.data.map(toProductDTO), total, page, perPage: PER_PAGE };
  } catch (err) {
    // a Nuvemshop responde 404 quando a busca não acha nada ou a página passou do fim
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return { products: [], total: 0, page, perPage: PER_PAGE };
    }
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      throw new ApiError("muitas requisições à Nuvemshop, tente de novo em instantes", 429);
    }
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      throw new ApiError("token da loja inválido, reinstale o app", 401);
    }
    throw new ApiError("falha ao buscar produtos na Nuvemshop", 502);
  }
}
