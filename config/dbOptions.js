"use strict";

function buildDbOptions(env = process.env) {
    const databaseUrl =
        env.DATABASE_URL ||
        env.POSTGRES_URL ||
        env.DATABASE_PUBLIC_URL;

    const expectedDatabaseName = String(env.DB_EXPECTED_NAME || "").trim();
    const databaseName = databaseUrl
        ? decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
        : String(env.DB_NAME || "").trim();

    if (expectedDatabaseName && databaseName !== expectedDatabaseName) {
        throw new Error("O banco configurado nao corresponde a DB_EXPECTED_NAME. Confira a conexao do PetFlow original.");
    }

    const sslOptions = env.DB_SSL === "true"
        ? { ssl: { rejectUnauthorized: false } }
        : {};

    if (databaseUrl) {
        return {
            connectionString: databaseUrl,
            ...sslOptions
        };
    }

    return {
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        ...sslOptions
    };
}

module.exports = {
    buildDbOptions
};
