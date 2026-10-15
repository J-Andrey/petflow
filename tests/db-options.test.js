"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDbOptions } = require("../config/dbOptions");

// Todas as opções são injetadas: não lê .env nem abre conexão PostgreSQL.
const fields = {
    DB_HOST: "db.example.test", DB_PORT: "5432", DB_NAME: "petflow_test_fields",
    DB_USER: "synthetic-user", DB_PASSWORD: "synthetic-password"
};
const expectedFields = {
    host: fields.DB_HOST, port: fields.DB_PORT, database: fields.DB_NAME,
    user: fields.DB_USER, password: fields.DB_PASSWORD
};
const urls = {
    DATABASE_URL: "postgresql://synthetic:TEST_PASSWORD@primary.example.test/petflow_test_primary",
    POSTGRES_URL: "postgresql://synthetic:TEST_PASSWORD@secondary.example.test/petflow_test_secondary",
    DATABASE_PUBLIC_URL: "postgresql://synthetic:TEST_PASSWORD@public.example.test/petflow_test_public"
};

for (const [label, ssl] of [["true", "true"], ["false", "false"], ["ausente", undefined]]) {
    test("DB_SSL=" + label + " é aplicado igualmente a URL e campos separados", () => {
        const flag = ssl === undefined ? {} : { DB_SSL: ssl };
        const expectedSsl = ssl === "true" ? { ssl: { rejectUnauthorized: false } } : {};
        assert.deepEqual(buildDbOptions({ ...fields, ...flag, DB_EXPECTED_NAME: fields.DB_NAME }),
            { ...expectedFields, ...expectedSsl });
        for (const [key, url] of Object.entries(urls)) {
            assert.deepEqual(buildDbOptions({ [key]: url, ...flag, DB_EXPECTED_NAME: new URL(url).pathname.slice(1) }),
                { connectionString: url, ...expectedSsl });
        }
    });
}

test("SSL conserva a política existente: somente a string true adiciona opções", () => {
    for (const flag of ["TRUE", "1", "", true]) {
        assert.equal(Object.hasOwn(buildDbOptions({ ...fields, DB_SSL: flag }), "ssl"), false);
    }
    const url = urls.DATABASE_URL + "?sslmode=require";
    assert.deepEqual(buildDbOptions({ DATABASE_URL: url, DB_SSL: "false" }), { connectionString: url });
});

test("URLs preservam precedência sobre aliases e campos, inclusive com DB_SSL=true", () => {
    const env = { ...fields, ...urls, DB_SSL: "true" };
    for (const [key, url] of Object.entries(urls)) {
        const expected = new URL(url).pathname.slice(1);
        assert.deepEqual(buildDbOptions({ ...env, DB_EXPECTED_NAME: expected }),
            { connectionString: url, ssl: { rejectUnauthorized: false } });
        assert.throws(() => buildDbOptions({ ...env, DB_EXPECTED_NAME: fields.DB_NAME }), /DB_EXPECTED_NAME/);
        env[key] = "";
    }
    assert.deepEqual(buildDbOptions({ ...env, DB_EXPECTED_NAME: fields.DB_NAME }),
        { ...expectedFields, ssl: { rejectUnauthorized: false } });
});

test("DB_EXPECTED_NAME continua rejeitando banco divergente com SSL true, false ou ausente", () => {
    for (const ssl of ["true", "false", undefined]) {
        const env = { ...fields, DB_SSL: ssl, DB_EXPECTED_NAME: "petflow_test_wrong" };
        assert.throws(() => buildDbOptions(env), /DB_EXPECTED_NAME/);
        for (const [key, url] of Object.entries(urls)) {
            assert.throws(() => buildDbOptions({ ...env, [key]: url }), /DB_EXPECTED_NAME/);
        }
    }
});

test("validação preserva decoding de URL, trim do nome esperado e rejeição de URL inválida", () => {
    const url = "postgresql://synthetic:TEST_PASSWORD@db.example.test/%70etflow_test_encoded";
    assert.equal(buildDbOptions({ DATABASE_URL: url, DB_EXPECTED_NAME: " petflow_test_encoded " }).connectionString, url);
    assert.deepEqual(buildDbOptions({ ...fields, DB_NAME: " petflow_test_fields ", DB_EXPECTED_NAME: " petflow_test_fields " }),
        { ...expectedFields, database: " petflow_test_fields " });
    assert.throws(() => buildDbOptions({ ...fields, DATABASE_URL: "invalid-url", DB_SSL: "true" }), { code: "ERR_INVALID_URL" });
});
