"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkConfiguration } = require("../scripts/check-config");
const { shippingPaths, containsCredential } = require("../scripts/package-release");
function configuration() {
  return {
    NODE_ENV: "production", DATABASE_URL: "postgresql://owner:EXAMPLE_PASSWORD@db.example.test/petflow", DB_EXPECTED_NAME: "petflow", DB_SSL: "true",
    JWT_SECRET: "fixture-secret-only-for-unit-tests-0123456789", JWT_EXPIRES_IN: "7d", APP_URL: "https://shop.example.test", FRONTEND_URL: "https://shop.example.test",
    CLOUDINARY_CLOUD_NAME: "buyer-shop", CLOUDINARY_API_KEY: "1234", CLOUDINARY_API_SECRET: "fixture", RESEND_API_KEY: "fixture", EMAIL_FROM: "Loja <contato@example.test>",
    PAGSEGURO_TOKEN: "fixture", PAGSEGURO_BASE_URL: "https://api.pagseguro.com", PAGSEGURO_ENABLE_DEBIT: "false", GOOGLE_MAPS_API_KEY: "fixture", GOOGLE_MAPS_BROWSER_API_KEY: "fixture",
    DELIVERY_ORIGIN_ADDRESS: "Endereço da loja", DELIVERY_FREE_DISTANCE_KM: "1", DELIVERY_PRICE_PER_KM: "3", DELIVERY_MAX_DISTANCE_KM: "20", DELIVERY_CHARGE_FRACTION: "true"
  };
}
test("configuração para comprador aceita configuração completa e detecta divergência de banco", () => {
  const env = configuration(); assert.equal(checkConfiguration(env).ok, true);
  env.DB_EXPECTED_NAME = "outro";
  assert.ok(checkConfiguration(env).issues.some(item => item.key === "DB_EXPECTED_NAME"));
});
test("diagnóstico não inclui segredos mesmo com URLs inválidas ou ambientes Cloudinary divergentes", () => {
  const env = configuration();
  env.DATABASE_URL = "invalid://private-password-value";
  env.CLOUDINARY_URL = "cloudinary://1234:EXAMPLE_PASSWORD@different-cloud";
  const report = checkConfiguration(env);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(item => item.key === "CLOUDINARY_CLOUD_NAME"));
  assert.doesNotMatch(JSON.stringify(report), /private-password-value|EXAMPLE_PASSWORD|fixture-secret/);
});
test("produção rejeita URL local, segredo fraco, modelo não preenchido e frete inconsistente", () => {
  const env = configuration(); Object.assign(env, { APP_URL: "http://localhost:4500", JWT_SECRET: "x".repeat(40), CLOUDINARY_API_SECRET: "sua_api_secret", DELIVERY_MAX_DISTANCE_KM: "0" });
  const keys = checkConfiguration(env).issues.map(item => item.key);
  for (const key of ["APP_URL", "JWT_SECRET", "CLOUDINARY_API_SECRET", "DELIVERY_MAX_DISTANCE_KM"]) assert.ok(keys.includes(key));
});
test("pacote de comprador exclui credenciais, backups, operação da instância e artefatos locais", () => {
  assert.deepEqual(shippingPaths([".env", ".env.production", ".env.example", "public/.env", "public/uploads/cliente.png", ".backups/store.dump", "docs/PRODUCAO.md", "PROMPT-PETFLOW-ORIGINAL.md", "public/logo.png", "scripts/check-config.js", "docs/ENTREGA-COMERCIAL.md", "database/sql/124_fila_emails_admin.sql", "public/debug.key", "public/../.env"]), [".env.example", "database/sql/124_fila_emails_admin.sql", "docs/ENTREGA-COMERCIAL.md", "public/logo.png", "scripts/check-config.js"]);
});
test("detecção de credenciais permite exemplos e bloqueia chave privada ou conexão com senha literal", () => {
  assert.equal(containsCredential("DATABASE_URL=postgresql://user:EXAMPLE_PASSWORD@host/petflow"), false);
  assert.equal(containsCredential("postgresql://user:" + "random-real-looking-secret" + "@host/petflow"), true);
  assert.equal(containsCredential("-----BEGIN " + "PRIVATE KEY-----"), true);
});
