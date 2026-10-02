import { describe, expect, it } from "vitest";
import { parseConfigUpdate } from "@/app/api/config/config.service";
import { DESIGN_OPTIONS } from "@/lib/design-options";
import { ApiError } from "@/lib/http";

function apiError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    return err as ApiError;
  }
  throw new Error("deveria ter lançado ApiError 400");
}

describe("parseConfigUpdate — minQuantity", () => {
  it.each([1, 3, 999])("%d é aceito", (minQuantity) => {
    expect(parseConfigUpdate({ minQuantity })).toEqual({ minQuantity });
  });

  it.each([0, -1, 1000, 2.5, "3", null, NaN, Infinity, true, [3]])("%j → 400", (minQuantity) => {
    expect(apiError(() => parseConfigUpdate({ minQuantity })).message).toMatch(/minQuantity/);
  });
});

describe("parseConfigUpdate — atcStoreType", () => {
  it("\"all\" é aceito", () => {
    expect(parseConfigUpdate({ atcStoreType: "all" })).toEqual({ atcStoreType: "all" });
  });

  it.each(["product", "mixed", "ALL", "", null, "xpto"])("%j → 400 (modo indisponível)", (atcStoreType) => {
    expect(apiError(() => parseConfigUpdate({ atcStoreType })).message).toBe("modo de atacado indisponível");
  });
});

describe("parseConfigUpdate — designOption", () => {
  it.each([...DESIGN_OPTIONS])("modelo %d é aceito", (designOption) => {
    expect(parseConfigUpdate({ designOption })).toEqual({ designOption });
  });

  // 99 é inteiro "válido", mas não é um modelo que existe
  it.each([0, 99, -1, 1.5, "1", null])("%j → 400 (modelo indisponível)", (designOption) => {
    expect(apiError(() => parseConfigUpdate({ designOption })).message).toBe("modelo de exibição indisponível");
  });
});

describe("parseConfigUpdate — body", () => {
  it.each([{}, null, undefined, [], "texto", 5])("body %j sem campos → 400 nada para atualizar", (body) => {
    expect(apiError(() => parseConfigUpdate(body)).message).toBe("nada para atualizar");
  });

  it("só campos desconhecidos → 400 (não vira update vazio)", () => {
    expect(apiError(() => parseConfigUpdate({ promotionId: "x", storeId: 999 })).message).toBe("nada para atualizar");
  });

  it("campos desconhecidos não vazam para o update (promotionId/storeId)", () => {
    expect(parseConfigUpdate({ minQuantity: 5, promotionId: "hack", storeId: 999 })).toEqual({ minQuantity: 5 });
  });

  it("vários campos válidos juntos", () => {
    expect(parseConfigUpdate({ minQuantity: 10, atcStoreType: "all", designOption: 1 })).toEqual({
      minQuantity: 10,
      atcStoreType: "all",
      designOption: 1,
    });
  });

  it("um campo inválido derruba o update inteiro", () => {
    expect(() => parseConfigUpdate({ minQuantity: 10, designOption: 0 })).toThrow(ApiError);
  });
});
