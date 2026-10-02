// app/api/callbacks/discounts/route.ts
// Callback de descontos da Nuvemshop (server-to-server). Nunca pode travar o checkout:
// erro, JSON inválido ou demora → 204 (sem mudança).

import { handleDiscountCallback, type CallbackResult, type DiscountCallbackPayload } from "./discount.service";

// a Nuvemshop desiste em 800 ms; respondemos 204 antes disso
const CALLBACK_TIMEOUT_MS = 700;

const NO_CHANGE: CallbackResult = { status: 204, body: null };

function withTimeout(promise: Promise<CallbackResult>, ms: number): Promise<CallbackResult> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<CallbackResult>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[callbacks/discounts] timeout de ${ms} ms`);
      resolve(NO_CHANGE);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as DiscountCallbackPayload;
    const { status, body } = await withTimeout(handleDiscountCallback(payload), CALLBACK_TIMEOUT_MS);
    return body === null ? new Response(null, { status }) : Response.json(body, { status });
  } catch (err) {
    console.error("[callbacks/discounts]", err);
    return new Response(null, { status: 204 });
  }
}
