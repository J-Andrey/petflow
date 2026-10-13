"use strict";

// Verificação offline: nenhuma credencial ou URL com senha é incluída no relatório.
function checkConfiguration(env, { production = env.NODE_ENV === "production" } = {}) {
  const issues = [];
  const add = (key, message) => issues.push({ key, message });
  const placeholder = /^(troque|sua?_|seu_|preencha|change.?me|example|exemplo)/i;
  const required = (key) => {
    const value = String(env[key] || "").trim();
    if (!value || placeholder.test(value)) add(key, "Preencha com o valor da instalação do comprador.");
    return value;
  };
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL || env.DATABASE_PUBLIC_URL;
  let databaseName;
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
      databaseName = decodeURIComponent(url.pathname.slice(1));
      if (!databaseName || !url.hostname || !url.username) throw new Error();
    } catch { add("DATABASE_URL", "A conexão PostgreSQL está incompleta ou inválida."); }
  } else {
    for (const key of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]) required(key);
    databaseName = env.DB_NAME;
  }
  const expected = required("DB_EXPECTED_NAME");
  if (expected && databaseName && expected !== databaseName) add("DB_EXPECTED_NAME", "O nome não corresponde ao banco configurado.");
  const secret = required("JWT_SECRET");
  if (secret && (Buffer.byteLength(secret) < 32 || new Set(secret).size < 10)) add("JWT_SECRET", "Gere uma chave aleatória com pelo menos 32 bytes.");
  const expiry = required("JWT_EXPIRES_IN");
  if (expiry && !/^\d+(ms|s|m|h|d|w|y)$/.test(expiry)) add("JWT_EXPIRES_IN", "Use duração explícita, por exemplo 7d ou 12h.");
  for (const key of ["APP_URL", "FRONTEND_URL"]) {
    const value = required(key);
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error();
      if (production && (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error();
    } catch { if (value) add(key, production ? "Use a URL pública HTTPS, sem credenciais, consulta ou fragmento." : "Use uma URL HTTP/HTTPS válida."); }
  }
  const cloudName = required("CLOUDINARY_CLOUD_NAME");
  required("CLOUDINARY_API_KEY"); required("CLOUDINARY_API_SECRET");
  if (cloudName && !/^[a-z][a-z0-9-]{1,127}$/i.test(cloudName)) add("CLOUDINARY_CLOUD_NAME", "Use o identificador real do ambiente Cloudinary, sem espaços.");
  if (env.CLOUDINARY_URL) {
    try {
      const url = new URL(env.CLOUDINARY_URL);
      if (url.protocol !== "cloudinary:") throw new Error();
      if (url.hostname.toLowerCase() !== cloudName.toLowerCase()) add("CLOUDINARY_CLOUD_NAME", "O identificador diverge de CLOUDINARY_URL; confira os valores no mesmo ambiente.");
      for (const [key, value] of [["CLOUDINARY_API_KEY", url.username], ["CLOUDINARY_API_SECRET", url.password]]) {
        if (env[key] && decodeURIComponent(value) !== env[key]) add(key, "O valor diverge de CLOUDINARY_URL.");
      }
    } catch { add("CLOUDINARY_URL", "Formato inválido; confira a conexão no painel Cloudinary."); }
  }
  required("RESEND_API_KEY");
  const sender = required("EMAIL_FROM");
  if (sender && !/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(sender) && !/^[^<>]+<[^<>\s]+@[^<>\s]+\.[^<>\s]+>$/.test(sender)) add("EMAIL_FROM", "Use um remetente válido no domínio verificado do comprador.");
  required("PAGSEGURO_TOKEN");
  if (required("PAGSEGURO_BASE_URL") !== "https://api.pagseguro.com") add("PAGSEGURO_BASE_URL", "Esta entrega usa a API de produção https://api.pagseguro.com.");
  required("GOOGLE_MAPS_API_KEY"); required("GOOGLE_MAPS_BROWSER_API_KEY"); required("DELIVERY_ORIGIN_ADDRESS");
  const numbers = {};
  for (const key of ["DELIVERY_FREE_DISTANCE_KM", "DELIVERY_PRICE_PER_KM", "DELIVERY_MAX_DISTANCE_KM"]) {
    const value = required(key); numbers[key] = Number(value);
    if (value && (!Number.isFinite(numbers[key]) || numbers[key] < 0)) add(key, "Use um número válido maior ou igual a zero.");
  }
  if (!(numbers.DELIVERY_MAX_DISTANCE_KM > numbers.DELIVERY_FREE_DISTANCE_KM)) add("DELIVERY_MAX_DISTANCE_KM", "O alcance deve ser maior que a faixa gratuita.");
  for (const key of ["DELIVERY_CHARGE_FRACTION", "DB_SSL", "PAGSEGURO_ENABLE_DEBIT"]) {
    if (!["true", "false"].includes(env[key])) add(key, "Use true ou false explicitamente.");
  }
  return { ok: issues.length === 0, mode: production ? "production" : "development", issues };
}

if (require.main === module) {
  require("dotenv").config({ quiet: true, path: process.env.PETFLOW_ENV_FILE || ".env" });
  const result = checkConfiguration(process.env);
  if (process.argv.includes("--json")) console.log(JSON.stringify(result));
  else {
    console.log(result.ok ? "Configuração offline válida." : "Configuração incompleta:");
    for (const issue of result.issues) console.log("- " + issue.key + ": " + issue.message);
    console.log("Esta verificação não confirma credenciais no provedor nem substitui compra e entrega reais.");
  }
  process.exitCode = result.ok ? 0 : 1;
}
module.exports = { checkConfiguration };
