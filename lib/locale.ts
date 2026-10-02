// lib/locale.ts
// Idioma do app conforme a loja (homologação: o app precisa se adaptar à região que vem no GET /store).

export const LOCALES = ["pt", "es", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** "Atacado" visível para o lojista e o cliente (nome da promoção, texto do desconto no checkout). */
export const WHOLESALE_LABEL: Record<Locale, string> = { pt: "Atacado", es: "Mayorista", en: "Wholesale" };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * "pt_BR", "es-AR", "EN" → prefixo do idioma, se suportado.
 * Idioma desconhecido ou ausente: loja do Brasil → pt; qualquer outro país → es (Tiendanube).
 */
export function resolveLocale(language?: string | null, country?: string | null): Locale {
  const prefix = typeof language === "string" ? language.trim().toLowerCase().split(/[-_]/)[0] : "";
  if (isLocale(prefix)) return prefix;
  return typeof country === "string" && country.trim().toUpperCase() === "BR" ? "pt" : "es";
}

/**
 * Primeiro idioma suportado do Accept-Language ("fr-FR,es-AR;q=0.9" → es), para páginas
 * em que a loja ainda não é conhecida (erro no install). Nenhum suportado ou sem header → pt.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of (header ?? "").split(",")) {
    const prefix = part.split(";")[0].trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(prefix)) return prefix;
  }
  return "pt";
}
