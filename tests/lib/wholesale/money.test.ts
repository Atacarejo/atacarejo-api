import { describe, expect, it } from "vitest";
import { fromCents, toCents } from "@/lib/wholesale/money";

describe("toCents", () => {
  it.each([
    ["10,50", 1050],
    ["10.50", 1050],
    ["10.5", 1050],
    ["10,5", 1050],
    [" 10 ", 1000],
    ["\t7,01\n", 701],
    ["0", 0],
    ["0,00", 0],
    ["0000000001", 100], // 10 dígitos com zeros à esquerda ainda é válido
    ["9999999999.99", 999999999999], // limite do numeric(12,2)
  ])("string %j → %d", (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it.each([
    "1.000,00", // separador de milhar não é aceito
    "1,000.00",
    "1.000",
    "10.555", // mais de 2 casas
    "",
    "   ",
    "abc",
    "10a",
    "-1",
    "-0,50",
    "+10",
    ".50",
    "10.",
    "10,",
    "1 000",
    "10,5,0",
    "12345678901", // 11 dígitos inteiros
    "12345678901.00",
    "１０", // dígitos unicode (fullwidth)
    "1e3",
    "0x10",
    "Infinity",
    "NaN",
  ])("string inválida %j → null", (input) => {
    expect(toCents(input)).toBeNull();
  });

  it.each([
    [10, 1000],
    [10.5, 1050],
    [10.55, 1055],
    [0, 0],
    [-0, 0],
    [0.1 + 0.2, 30], // 0.30000000000000004 não pode virar null nem 31
    [1.1 * 3, 330], // 3.3000000000000003
    [19.99, 1999],
    [0.01, 1],
    [12345678.91, 1234567891],
  ])("número %d → %d", (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it.each([
    [10.555, "3 casas decimais"],
    [1.005, "3 casas decimais (vira 100.4999… em float)"],
    [0.001, "3 casas decimais"],
    [-1, "negativo"],
    [-10.5, "negativo"],
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
    [1e10, "11 dígitos inteiros"],
    [1e21, "notação exponencial no toFixed"],
  ])("número %d (%s) → null", (input) => {
    expect(toCents(input)).toBeNull();
  });

  it.each([null, undefined, true, false, {}, [], ["10"]])("tipo não suportado %j → null", (input) => {
    expect(toCents(input)).toBeNull();
  });

  it("bigint → null", () => {
    expect(toCents(BigInt(10))).toBeNull();
  });

  // BUG: a checagem `Math.abs(Math.round(v*100) - v*100) > 1e-6` usa tolerância absoluta.
  // Acima de ~R$ 100 milhões o erro de float de v*100 passa de 1e-6 e valores válidos
  // com 2 casas (que cabem no numeric(12,2)) viram null quando chegam como number.
  it("número grande com 2 casas dentro do numeric(12,2) é aceito (275450510.65)", () => {
    expect(toCents(275450510.65)).toBe(27545051065);
  });

  it("string equivalente ao número grande é aceita (o bug é só no caminho number)", () => {
    expect(toCents("275450510.65")).toBe(27545051065);
  });
});

describe("fromCents", () => {
  it.each([
    [1050, "10.50"],
    [1000, "10.00"],
    [5, "0.05"],
    [0, "0.00"],
    [99, "0.99"],
    [100, "1.00"],
    [999999999999, "9999999999.99"],
    [-1050, "-10.50"],
    [-5, "-0.05"],
    [-100, "-1.00"],
  ])("%d → %j", (input, expected) => {
    expect(fromCents(input)).toBe(expected);
  });

  it("arredonda centavos fracionados", () => {
    expect(fromCents(1050.4)).toBe("10.50");
    expect(fromCents(1050.5)).toBe("10.51");
    expect(fromCents(1050.6)).toBe("10.51");
  });

  it("-0 vira 0.00 (sem sinal)", () => {
    expect(fromCents(-0)).toBe("0.00");
  });

  // BUG: o sinal é decidido antes do arredondamento; -0.4 arredonda para 0 mas mantém o "-".
  it("valor negativo que arredonda para zero não gera \"-0.00\"", () => {
    expect(fromCents(-0.4)).toBe("0.00");
  });

  it("ida e volta toCents → fromCents preserva o valor", () => {
    for (const s of ["0.01", "10.50", "123.45", "9999999999.99"]) {
      expect(fromCents(toCents(s)!)).toBe(s);
    }
  });
});
