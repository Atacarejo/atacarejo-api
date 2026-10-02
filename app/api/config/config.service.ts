// app/api/config/config.service.ts
import { type DesignOption, isDesignOption } from "@/lib/design-options";
import { ApiError } from "@/lib/http";

// modos ainda não implementados não podem ser escolhidos pelo lojista
const ENABLED_MODES = ["all"] as const;

export type ConfigUpdate = { minQuantity?: number; atcStoreType?: "all"; designOption?: DesignOption };

export function parseConfigUpdate(body: unknown): ConfigUpdate {
  const b = (body ?? {}) as Record<string, unknown>;
  const update: ConfigUpdate = {};

  if (b.minQuantity !== undefined) {
    const n = b.minQuantity;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 999) {
      throw new ApiError("minQuantity deve ser um inteiro entre 1 e 999", 400, "invalid_min_quantity", { min: 1, max: 999 });
    }
    update.minQuantity = n;
  }

  if (b.atcStoreType !== undefined) {
    if (!ENABLED_MODES.includes(b.atcStoreType as "all")) {
      throw new ApiError("modo de atacado indisponível", 400, "invalid_store_type");
    }
    update.atcStoreType = b.atcStoreType as "all";
  }

  if (b.designOption !== undefined) {
    if (!isDesignOption(b.designOption)) throw new ApiError("modelo de exibição indisponível", 400, "invalid_design_option");
    update.designOption = b.designOption;
  }

  if (Object.keys(update).length === 0) throw new ApiError("nada para atualizar", 400, "nothing_to_update");
  return update;
}
