import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "@/lib/webhook-hmac";

const SECRET = "segredo-de-teste";
const sign = (body: string | Buffer, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ store_id: 123, event: "app/uninstalled" });

  it("hex válido → true", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("hex em maiúsculas → true", () => {
    expect(verifyWebhookSignature(body, sign(body).toUpperCase(), SECRET)).toBe(true);
  });

  it("espaços nas pontas da assinatura são tolerados", () => {
    expect(verifyWebhookSignature(body, ` ${sign(body)}\n`, SECRET)).toBe(true);
  });

  it("assinatura de outro body → false", () => {
    expect(verifyWebhookSignature(body, sign(body + " "), SECRET)).toBe(false);
  });

  it("segredo errado → false", () => {
    expect(verifyWebhookSignature(body, sign(body, "outro"), SECRET)).toBe(false);
  });

  it.each([
    ["curta", (s: string) => s.slice(0, 10)],
    ["um char a menos", (s: string) => s.slice(1)],
    ["um char a mais", (s: string) => s + "0"],
    ["dobrada", (s: string) => s + s],
    ["base64 em vez de hex", () => createHmac("sha256", SECRET).update(body).digest("base64")],
  ])("tamanho/formato errado (%s) → false sem lançar", (_l, mutate) => {
    const sig = mutate(sign(body));
    expect(() => verifyWebhookSignature(body, sig, SECRET)).not.toThrow();
    expect(verifyWebhookSignature(body, sig, SECRET)).toBe(false);
  });

  it("assinatura com caracteres multibyte do mesmo tamanho em chars → false sem lançar", () => {
    // 64 chars, mas mais de 64 bytes em utf8 → comprimentos diferentes no timingSafeEqual
    const sig = "é".repeat(64);
    expect(() => verifyWebhookSignature(body, sig, SECRET)).not.toThrow();
    expect(verifyWebhookSignature(body, sig, SECRET)).toBe(false);
  });

  it("segredo vazio → false (mesmo com assinatura feita com segredo vazio)", () => {
    expect(verifyWebhookSignature(body, sign(body, ""), "")).toBe(false);
  });

  it.each([null, ""])("assinatura %j → false", (sig) => {
    expect(verifyWebhookSignature(body, sig, SECRET)).toBe(false);
  });

  it("body com unicode: HMAC é sobre os bytes utf8 do body cru", () => {
    const uni = JSON.stringify({ store_id: 1, nome: "Açúcar & Café ☕ — 日本" });
    expect(verifyWebhookSignature(uni, sign(Buffer.from(uni, "utf8")), SECRET)).toBe(true);
    // assinatura calculada como latin1 não pode bater
    expect(verifyWebhookSignature(uni, sign(Buffer.from(uni, "latin1")), SECRET)).toBe(false);
  });

  it("body re-serializado (espaços diferentes) não bate — precisa ser o body cru", () => {
    const raw = '{"store_id": 1,  "x": "y"}';
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(verifyWebhookSignature(reserialized, sign(raw), SECRET)).toBe(false);
  });

  it("body vazio com assinatura correta → true", () => {
    expect(verifyWebhookSignature("", sign(""), SECRET)).toBe(true);
  });
});
