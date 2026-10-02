// RASCUNHO (não usado): regra de pagamento do atacado.
// Atacado → só Pix. Se a loja não tiver Pix, não esconde nada (não pode travar a venda).

export type PaymentOption = { providerId: string; optionId: string; methodTypes: string[] };
export type FilteredPayment = { id: string; option_id: string };

const KEEP_METHOD_TYPES = new Set(["pix"]);

/** Opções a ESCONDER (formato de `filtered_options` do comando filter_payments_options). */
export function paymentOptionsToHide(isWholesale: boolean, options: PaymentOption[]): FilteredPayment[] {
  if (!isWholesale) return [];

  const keep = (o: PaymentOption) => o.methodTypes.some((t) => KEEP_METHOD_TYPES.has(t.toLowerCase()));
  if (!options.some(keep)) return [];

  return options.filter((o) => !keep(o)).map((o) => ({ id: o.providerId, option_id: o.optionId }));
}
