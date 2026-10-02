// lib/http.ts
// Erros com status HTTP e um wrapper que transforma qualquer erro em resposta JSON.

/**
 * Códigos estáveis dos erros (contrato com o front do admin, que traduz para pt/es/en).
 * Nunca renomeie um código existente: o front mapeia por ele. `message` continua em português
 * só para compatibilidade e logs.
 */
export type ErrorCode =
  // genéricos
  | "invalid_json"
  | "unauthorized"
  | "internal_error"
  // loja / Nuvemshop
  | "store_not_installed"
  | "invalid_token"
  | "rate_limited"
  | "nuvemshop_unavailable"
  | "setup_failed"
  // instalação (OAuth)
  | "missing_code"
  | "token_exchange_failed"
  | "token_not_found"
  // PUT /api/config
  | "invalid_min_quantity"
  | "invalid_store_type"
  | "invalid_design_option"
  | "nothing_to_update"
  // /api/wholesale
  | "too_many_variants"
  | "invalid_items"
  | "too_many_items"
  | "invalid_item_id"
  | "duplicate_variant"
  | "missing_price"
  | "invalid_price"
  // rotas públicas e webhooks
  | "invalid_store_id"
  | "invalid_signature";

/** Valores para o front montar o texto traduzido (ex.: { index: 3 }, { max: 1000 }). */
export type ErrorParams = Record<string, string | number>;

/** Corpo JSON de erro: { message, code } (+ params quando o texto depende de valores). */
export function errorBody(message: string, code: ErrorCode, params?: ErrorParams) {
  return params ? { message, code, params } : { message, code };
}

/** Erro esperado: a mensagem e o código vão para o cliente com o status informado. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: ErrorCode,
    public params?: ErrorParams,
  ) {
    super(message);
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Envolve um route handler: ApiError vira { message, code } com o status dele,
 * qualquer outro erro vira 500 genérico (sem vazar detalhes nem tokens).
 */
export function withErrors<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json(errorBody(err.message, err.code, err.params), { status: err.status });
      }
      return internalError(err);
    }
  };
}

/**
 * 500 genérico com Request-ID (exigência da homologação) para cruzar com os logs.
 * Nunca devolve detalhes do erro nem tokens.
 */
export function internalError(err: unknown, headers: Record<string, string> = {}): Response {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  return Response.json(
    { ...errorBody("erro interno", "internal_error"), requestId },
    { status: 500, headers: { ...headers, "x-request-id": requestId } },
  );
}

/** Lê o body como JSON; body vazio ou inválido vira 400. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError("JSON inválido", 400, "invalid_json");
  }
}

/** Converte "123" em 123. Aceita só inteiros positivos (IDs da Nuvemshop). */
export function parseId(value: unknown): number | null {
  const s = typeof value === "number" ? String(value) : value;
  if (typeof s !== "string" || !/^[1-9]\d{0,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
