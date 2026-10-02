// lib/design-options.ts
// Modelos de exibição do atacado na vitrine (store_config.design_option).
// O lojista escolhe no admin e o NubeSDK lê pela rota pública (design_option).
// Novo modelo: adicione o id aqui, no front (src/lib/design-options.ts) e no SDK.

export const DESIGN_OPTIONS = [1] as const;

export type DesignOption = (typeof DESIGN_OPTIONS)[number];

export const DEFAULT_DESIGN_OPTION: DesignOption = 1;

export function isDesignOption(value: unknown): value is DesignOption {
  return DESIGN_OPTIONS.includes(value as DesignOption);
}
