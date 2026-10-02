// lib/wholesale/money.ts
// Dinheiro sempre em centavos (inteiro) para não somar erro de ponto flutuante.

/**
 * Converte "10.50", "10,50", "10" ou 10.5 em 1050. Retorna null se não for um valor
 * válido com no máximo 2 casas decimais. Não aceita separador de milhar.
 */
export function toCents(value: unknown): number | null {
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    s = value.toFixed(2);
    // mais de 2 casas (ex.: 10.555) é inválido, igual à string "10.555".
    // tolerância relativa: valores grandes têm mais erro de ponto flutuante
    if (Math.abs(Number(s) - value) > 1e-9 * Math.max(1, Math.abs(value))) return null;
  } else if (typeof value === "string") {
    s = value.trim().replace(",", ".");
  } else {
    return null;
  }

  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return null;
  const [, int, dec = ""] = match;
  return Number(int) * 100 + Number(dec.padEnd(2, "0"));
}

/** 1050 → "10.50" (formato do numeric(12,2) e da API da Nuvemshop). */
export function fromCents(cents: number): string {
  if (!Number.isFinite(cents)) throw new Error(`valor inválido: ${cents}`);
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
