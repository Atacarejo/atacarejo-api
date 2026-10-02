// lib/store-info.ts
// Idioma, país e moeda da loja a partir do GET /store da Nuvemshop.

import { type Locale, resolveLocale } from "@/lib/locale";

/** Campos do GET /store usados aqui (passar em ?fields= para não trazer a loja inteira). */
export const STORE_INFO_FIELDS = ["main_language", "languages", "country", "main_currency"] as const;

export type StoreInfo = { language: Locale; country: string | null; currency: string | null };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Normaliza a resposta do GET /store. Nunca lança: campo ausente ou de tipo errado vira null
 * (e o idioma cai na regra do país em resolveLocale).
 * Ex.: { main_language: "es", country: "AR", main_currency: "ARS", languages: { es: { currency: "ARS", active: true } } }
 */
export function toStoreInfo(data: unknown): StoreInfo {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const languages = (d.languages && typeof d.languages === "object" ? d.languages : {}) as Record<
    string,
    { currency?: unknown; active?: unknown } | null
  >;

  // sem main_language: primeiro idioma ativo da loja
  const mainLanguage =
    text(d.main_language) ?? Object.keys(languages).find((k) => languages[k]?.active === true) ?? null;
  const country = text(d.country)?.toUpperCase() ?? null;
  const currency =
    text(d.main_currency)?.toUpperCase() ?? (mainLanguage ? text(languages[mainLanguage]?.currency) : null);

  return { language: resolveLocale(mainLanguage, country), country, currency };
}
