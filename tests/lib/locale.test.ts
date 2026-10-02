import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage, resolveLocale, WHOLESALE_LABEL } from "@/lib/locale";

describe("resolveLocale", () => {
  it.each([
    ["pt", null, "pt"],
    ["pt_BR", null, "pt"],
    ["es-AR", null, "es"],
    ["ES", null, "es"],
    [" en ", null, "en"],
    ["en_US", "BR", "en"],
  ])("%s (país %s) → %s", (language, country, expected) => {
    expect(resolveLocale(language, country)).toBe(expected);
  });

  it.each([
    [null, "BR", "pt"],
    ["fr", "br", "pt"],
    ["", "AR", "es"],
    [undefined, undefined, "es"],
    ["xx", "US", "es"],
  ])("idioma %s não suportado, país %s → %s", (language, country, expected) => {
    expect(resolveLocale(language, country)).toBe(expected);
  });
});

describe("localeFromAcceptLanguage", () => {
  it("primeiro idioma suportado", () => {
    expect(localeFromAcceptLanguage("fr-FR,es-AR;q=0.9,pt;q=0.8")).toBe("es");
  });
  it("nenhum suportado ou sem header → pt", () => {
    expect(localeFromAcceptLanguage("fr-FR,de")).toBe("pt");
    expect(localeFromAcceptLanguage(null)).toBe("pt");
  });
});

describe("WHOLESALE_LABEL", () => {
  it("um texto por idioma", () => {
    expect(WHOLESALE_LABEL).toEqual({ pt: "Atacado", es: "Mayorista", en: "Wholesale" });
  });
});
