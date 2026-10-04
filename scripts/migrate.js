"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { buildDbOptions } = require("../config/dbOptions");

require("dotenv").config();

const SQL_DIR = path.join(__dirname, "..", "database", "sql");

const pool = new Pool(buildDbOptions());

async function run() {
    const files = (await fs.readdir(SQL_DIR))
        .filter((file) => file.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b));

    const client = await pool.connect();

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                nome VARCHAR(255) PRIMARY KEY,
                checksum VARCHAR(64) NOT NULL,
                aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        for (const file of files) {
            const filePath = path.join(SQL_DIR, file);
            const sql = await fs.readFile(filePath, "utf8");
            const checksum = crypto.createHash("sha256").update(sql).digest("hex");
            const applied = await client.query(
                "SELECT checksum FROM schema_migrations WHERE nome = $1",
                [file]
            );

            if (applied.rows[0]?.checksum === checksum) {
                console.log(`Ignorando ${file}: ja aplicado.`);
                continue;
            }

            if (applied.rows[0]) {
                throw new Error(
                    `A migracao ${file} foi alterada depois de aplicada. Crie um novo arquivo SQL em vez de editar a migracao existente.`
                );
            }

            console.log(`Aplicando ${file}...`);
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query(
                    "INSERT INTO schema_migrations (nome, checksum) VALUES ($1, $2)",
                    [file, checksum]
                );
                await client.query("COMMIT");
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }

        console.log("Banco de dados atualizado com sucesso.");
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch((error) => {
    console.error("Erro ao atualizar o banco de dados.");
    console.error(error);
    process.exit(1);
});
