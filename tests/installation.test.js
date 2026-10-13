"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { adminConfiguration, seedAdmin } = require("../scripts/seed-admin");
const { ensureDemoEnvironment, seedCatalog } = require("../scripts/seed-catalog");
const { load } = require("./helpers");

const adminEnv = { ADMIN_EMAIL: "  Dono@Example.test  ", ADMIN_PASSWORD: "uma frase exclusiva!", ADMIN_NAME: "Dono da loja" };

test("instalação exige credenciais próprias antes de acessar o banco", async () => {
    let queries = 0;
    const db = { async query() { queries++; } };
    for (const env of [{}, { ...adminEnv, ADMIN_EMAIL: "inválido" }, { ...adminEnv, ADMIN_PASSWORD: "Admin@123" }, { ...adminEnv, ADMIN_PASSWORD: " ".repeat(16) }, { ...adminEnv, ADMIN_PASSWORD: "é".repeat(37) }]) {
        await assert.rejects(seedAdmin(db, env), { code: "SEED_ADMIN_CONFIG" });
    }
    assert.equal(queries, 0);
    assert.equal(adminConfiguration(adminEnv).email, "dono@example.test");
});

test("primeiro administrador usa hash e preserva os espaços significativos da senha", async () => {
    const calls = [];
    const password = "  frase exclusiva para loja  ";
    const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: sql.includes("INSERT INTO") ? [{ id: "new" }] : [] }; } };
    const result = await seedAdmin(db, { ...adminEnv, ADMIN_PASSWORD: password }, async (received, rounds) => {
        assert.equal(received, password);
        assert.equal(rounds, 12);
        return "bcrypt-hash";
    });
    assert.deepEqual(result, { created: true });
    assert.deepEqual(calls[1].params, ["Dono da loja", "dono@example.test", "bcrypt-hash"]);
    assert.match(calls[1].sql, /ON CONFLICT DO NOTHING/);
    assert.ok(calls.every(call => !call.params.includes(password)));
});

test("repetir instalação não reseta senha, promove gerente nem reativa conta", async () => {
    const existing = { id: "existing", perfil: "GERENTE", ativo: false, senha_hash: "original", nome: "Gerente" };
    const before = { ...existing };
    const calls = [];
    const db = { async query(sql) { calls.push(sql); return { rows: [existing] }; } };
    const result = await seedAdmin(db, adminEnv, async () => { throw new Error("Não deve recalcular senha existente"); });
    assert.deepEqual(result, { created: false });
    assert.deepEqual(existing, before);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /LOWER\(email\)/);
});

test("duas instalações concorrentes preservam a conta criada primeiro", async () => {
    const db = { async query() { return { rows: [] }; } };
    assert.deepEqual(await seedAdmin(db, adminEnv, async () => "hash"), { created: false });
});

test("erro de configuração na CLI não exibe senha nem tenta usar o .env operacional", () => {
    const secret = "senha-sintetica-apenas-no-teste";
    const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/seed-admin.js")], {
        encoding: "utf8",
        env: { ...process.env, ADMIN_EMAIL: "inválido", ADMIN_PASSWORD: secret, PETFLOW_ENV_FILE: path.join(__dirname, "missing-seed-test.env") }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ADMIN_EMAIL/);
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
});

test("catálogo fictício exige opt-in e recusa produção antes de conectar", async () => {
    const pool = { async connect() { throw new Error("Conexão inesperada"); } };
    for (const env of [{}, { SEED_DEMO_CATALOG: "false", NODE_ENV: "development" }, { SEED_DEMO_CATALOG: "true", NODE_ENV: "production" }]) {
        await assert.rejects(seedCatalog(pool, env), { code: "SEED_DEMO_CONFIG" });
    }
    assert.doesNotThrow(() => ensureDemoEnvironment({ SEED_DEMO_CATALOG: "true", NODE_ENV: "development" }));
});

test("repetir catálogo preserva preços e não repõe estoque de produtos existentes", async () => {
    const calls = [];
    let released = false;
    const pool = { async connect() { return {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes("get_petflow_empresa_id")) return { rows: [{ id: "company" }] };
            if (sql.includes("SELECT id FROM categorias")) return { rows: [{ id: "category" }] };
            return { rows: [] };
        },
        release() { released = true; }
    }; } };
    await seedCatalog(pool, { SEED_DEMO_CATALOG: "true", NODE_ENV: "development" });
    assert.equal(released, true);
    assert.equal(calls.at(-1).sql, "COMMIT");
    assert.equal(calls.filter(call => call.sql.includes("INSERT INTO produtos")).length, 8);
    assert.ok(calls.every(call => !call.sql.includes("DO UPDATE") && !call.sql.includes("INSERT INTO estoque")));
});

test("catálogo novo registra estoque uma vez e reverte falha parcial", async () => {
    let failStock = false;
    const calls = [];
    const pool = { async connect() { return {
        async query(sql) {
            calls.push(sql);
            if (sql.includes("INSERT INTO estoque") && failStock) throw new Error("stock failed");
            return { rows: [{ id: "new-id" }] };
        },
        release() {}
    }; } };
    const env = { SEED_DEMO_CATALOG: "true", NODE_ENV: "development" };
    await seedCatalog(pool, env);
    assert.equal(calls.filter(sql => sql.includes("INSERT INTO estoque")).length, 8);
    failStock = true;
    await assert.rejects(seedCatalog(pool, env), /stock failed/);
    assert.equal(calls.at(-1), "ROLLBACK");
});

test("configuração sem remetente nunca herda e-mail do vendedor", () => {
    const keys = ["JWT_SECRET", "JWT_EXPIRES_IN", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "DATABASE_URL", "EMAIL_FROM", "EMAIL_TEST_TO"];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
        for (const key of keys) process.env[key] = "test-only";
        process.env.DATABASE_URL = "postgresql://localhost/petflow_test";
        delete process.env.EMAIL_FROM;
        delete process.env.EMAIL_TEST_TO;
        const env = load("config/env.js", { dotenv: { config() {} } });
        assert.equal(env.EMAIL_FROM, "");
        assert.equal(env.EMAIL_TEST_TO, "");
        process.env.EMAIL_FROM = "Minha Loja <contato@example.test>";
        process.env.EMAIL_TEST_TO = "operador@example.test";
        const configured = load("config/env.js", { dotenv: { config() {} } });
        assert.equal(configured.EMAIL_FROM, process.env.EMAIL_FROM);
        assert.equal(configured.EMAIL_TEST_TO, process.env.EMAIL_TEST_TO);
    } finally {
        for (const key of keys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
});
