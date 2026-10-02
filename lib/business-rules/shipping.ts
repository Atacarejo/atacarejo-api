// RASCUNHO (não usado): regra de frete do atacado.
// Varejo → esconde as opções especiais ("A Combinar", "Ônibus de Excursão").
// Atacado → mostra tudo.

export type ShippingOption = { carrierId: string; optionId: string; code: string | null; name: string | null };
export type FilteredShipping = { id: string; option_id: string; code: string };

const COMBINAR = /combinar/i;
const ONIBUS_EXCURSAO = /([oô]nibus.*excurs[aã]o)|(excurs[aã]o.*[oô]nibus)/i;

export function isSpecialShipping(option: ShippingOption): boolean {
  const text = `${option.name ?? ""} ${option.code ?? ""}`;
  return COMBINAR.test(text) || ONIBUS_EXCURSAO.test(text);
}

/** Opções a ESCONDER (formato de `filtered_options` do comando filter_shipping_options). */
export function shippingOptionsToHide(isWholesale: boolean, options: ShippingOption[]): FilteredShipping[] {
  if (isWholesale) return [];
  return options
    .filter(isSpecialShipping)
    .map((o) => ({ id: o.carrierId, option_id: o.optionId, code: o.code ?? "" }));
}
