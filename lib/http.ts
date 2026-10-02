// lib/http.ts
// Erros com status HTTP e um wrapper que transforma qualquer erro em resposta JSON.

/** Erro esperado: a mensagem vai para o cliente com o status informado. */
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Envolve um route handler: ApiError vira { message } com o status dele,
 * qualquer outro erro vira 500 genérico (sem vazar detalhes nem tokens).
 */
export function withErrors<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json({ message: err.message }, { status: err.status });
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
    { message: "erro interno", requestId },
    { status: 500, headers: { ...headers, "x-request-id": requestId } },
  );
}

/** Lê o body como JSON; body vazio ou inválido vira 400. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError("JSON inválido", 400);
  }
}

/** Converte "123" em 123. Aceita só inteiros positivos (IDs da Nuvemshop). */
export function parseId(value: unknown): number | null {
  const s = typeof value === "number" ? String(value) : value;
  if (typeof s !== "string" || !/^[1-9]\d{0,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
