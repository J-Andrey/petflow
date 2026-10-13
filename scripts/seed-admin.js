"use strict";

const bcrypt = require("bcrypt");

function adminConfiguration(env = process.env) {
    const email = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
    const password = env.ADMIN_PASSWORD;
    const name = String(env.ADMIN_NAME || "Administrador").trim();
    if (!email || email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw configurationError("Defina ADMIN_EMAIL com o e-mail do administrador da loja.");
    }
    // Bcrypt considera no máximo 72 bytes. Não normalizar nem cortar a senha.
    if (typeof password !== "string" || password.trim().length < 12 || Buffer.byteLength(password, "utf8") > 72) {
        throw configurationError("Defina ADMIN_PASSWORD com uma senha exclusiva de pelo menos 12 caracteres e no máximo 72 bytes.");
    }
    if (name.length < 3 || name.length > 150) {
        throw configurationError("ADMIN_NAME deve ter entre 3 e 150 caracteres.");
    }
    return { email, password, name };
}

function configurationError(message) {
    return Object.assign(new Error(message), { code: "SEED_ADMIN_CONFIG" });
}

async function seedAdmin(db, env = process.env, hashPassword = bcrypt.hash) {
    const admin = adminConfiguration(env);
    const existing = await db.query("SELECT id FROM usuarios WHERE LOWER(email) = $1", [admin.email]);
    if (existing.rows.length) return { created: false };

    const passwordHash = await hashPassword(admin.password, 12);
    const result = await db.query(`
        INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil, ativo)
        VALUES (get_petflow_empresa_id(), $1, $2, $3, 'ADMIN', TRUE)
        ON CONFLICT DO NOTHING
        RETURNING id`, [admin.name, admin.email, passwordHash]);
    // O índice de LOWER(email) também protege duas inicializações concorrentes.
    return { created: result.rows.length > 0 };
}

async function run() {
    require("dotenv").config({ quiet: true, path: process.env.PETFLOW_ENV_FILE || ".env" });
    adminConfiguration();
    const { Pool } = require("pg");
    const { buildDbOptions } = require("../config/dbOptions");
    const pool = new Pool(buildDbOptions());
    try {
        const result = await seedAdmin(pool);
        console.log(result.created
            ? "Administrador criado. Use o e-mail e a senha definidos para entrar no painel. Remova ADMIN_PASSWORD do ambiente após o cadastro."
            : "E-mail já cadastrado. Nenhuma senha, permissão ou situação da conta foi alterada. Use a recuperação de senha ou um administrador existente.");
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    run().catch((error) => {
        console.error(error.code === "SEED_ADMIN_CONFIG" ? error.message : "Não foi possível criar o administrador. Verifique a conexão e execute as migrações; detalhes foram omitidos para proteger credenciais.");
        process.exitCode = 1;
    });
}

module.exports = { adminConfiguration, seedAdmin, run };
