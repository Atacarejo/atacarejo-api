// lib/crypto.ts
// Criptografa e descriptografa strings (ex: access_token da Nuvemshop) com AES-256-GCM.
// Requer a variável de ambiente ENCRYPTION_KEY com 64 caracteres hex
// (gere com: openssl rand -hex 32)

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // tamanho recomendado para GCM

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("ENCRYPTION_KEY deve ter 64 caracteres hexadecimais");
  }
  return Buffer.from(hex, "hex");
}

/** Retorna "iv.tag.dados" em base64, pronto para salvar no banco. */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH); // novo a cada criptografia
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // detecta se o valor foi alterado

  return [iv, tag, encrypted].map((b) => b.toString("base64")).join(".");
}

/** Recebe o valor gerado por encrypt() e devolve o texto original. */
export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Formato de payload inválido");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(), // lança erro se a chave estiver errada ou o dado foi adulterado
  ]).toString("utf8");
}