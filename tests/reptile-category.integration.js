"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

// Executado apenas pelo runner que exige banco novo petflow_test... .
// Todos os cenários e alterações desta prova são desfeitos por ROLLBACK.
module.exports = async function verifyReptileCategory({ db, company, other }) {
    const migration = await fs.readFile(path.join(__dirname, "../database/sql/125_categoria_repteis.sql"), "utf8");
    const client = await db.connect();
    const allCategories = async () => (await client.query("SELECT * FROM categorias ORDER BY id")).rows;
    const productCount = async () => Number((await client.query("SELECT COUNT(*)::integer AS total FROM produtos")).rows[0].total);
    try {
        const database = (await client.query("SELECT current_database() AS name")).rows[0].name;
        assert.match(database, /^petflow_test[a-z0-9_]*$/);
        assert.equal((await client.query("SELECT get_petflow_empresa_id() AS id")).rows[0].id, company);
        const original = await allCategories();
        const originalProducts = await productCount();
        const initial = original.find(item => item.empresa_id === company && item.nome === "Répteis");
        assert.ok(initial, "A instalação nova deve conter a categoria solicitada.");
        assert.equal(initial.ativo, true);
        assert.equal(initial.status, true);
        assert.match(initial.descricao, /tartarugas, jabutis e outros répteis/);

        await client.query("BEGIN");
        try {
            // O banco é sintético e esta remoção é revertida ao fim do helper.
            await client.query("DELETE FROM categorias WHERE id=$1", [initial.id]);
            const beforeCreate = await allCategories();
            await client.query(migration);
            const created = (await client.query("SELECT * FROM categorias WHERE nome='Répteis'")).rows[0];
            assert.ok(created);
            assert.equal(created.empresa_id, company);
            assert.equal(created.ativo, true);
            assert.equal(created.status, true);
            assert.equal((await allCategories()).length, beforeCreate.length + 1);
            const afterCreate = await allCategories();
            await client.query(migration);
            assert.deepEqual(await allCategories(), afterCreate, "Reaplicar não altera UUID, timestamps, estado ou dados.");

            // Nenhuma variante legada deve ser duplicada, renomeada ou reativada.
            for (const name of ["Répteis", "répteis", "RÉPTEIS", "Repteis", "  REPTÉIS  "]) {
                await client.query("UPDATE categorias SET nome=$2,descricao='Descrição personalizada da loja',ativo=FALSE,status=FALSE WHERE id=$1", [created.id, name]);
                const before = await allCategories();
                await client.query(migration);
                await client.query(migration);
                assert.deepEqual(await allCategories(), before, "Categoria legada preservada: " + name);
                const preserved = before.find(item => item.id === created.id);
                assert.equal(preserved.nome, name);
                assert.equal(preserved.ativo, false);
                assert.equal(preserved.status, false);
                assert.equal(preserved.descricao, "Descrição personalizada da loja");
            }

            // O UNIQUE(nome) é global. Colisão não deve mover, editar ou ativar
            // uma categoria pertencente a outra empresa, nem quebrar a migração.
            await client.query("DELETE FROM categorias WHERE id=$1", [created.id]);
            const foreign = (await client.query("INSERT INTO categorias(empresa_id,nome,descricao,ativo,status) VALUES($1,'Répteis','Categoria externa preservada',FALSE,FALSE) RETURNING *", [other])).rows[0];
            const beforeConflict = await allCategories();
            await client.query(migration);
            await client.query(migration);
            assert.deepEqual(await allCategories(), beforeConflict);
            assert.equal((await client.query("SELECT COUNT(*)::integer AS total FROM categorias WHERE empresa_id=$1 AND nome='Répteis'", [company])).rows[0].total, 0);

            // Uma variante em outra empresa não representa um cadastro da loja.
            // Criar a categoria própria mantém o registro externo e seu dono.
            await client.query("UPDATE categorias SET nome='REPTEIS' WHERE id=$1", [foreign.id]);
            const foreignBefore = (await client.query("SELECT * FROM categorias WHERE id=$1", [foreign.id])).rows[0];
            await client.query(migration);
            const own = (await client.query("SELECT * FROM categorias WHERE empresa_id=$1 AND nome='Répteis'", [company])).rows[0];
            assert.ok(own);
            assert.equal(own.ativo, true);
            assert.equal(own.status, true);
            assert.deepEqual((await client.query("SELECT * FROM categorias WHERE id=$1", [foreign.id])).rows[0], foreignBefore);
            const finalCategories = await allCategories();
            await client.query(migration);
            assert.deepEqual(await allCategories(), finalCategories);
            assert.equal(await productCount(), originalProducts, "A categoria não cria produtos, preços ou estoque.");
        } finally {
            await client.query("ROLLBACK");
        }
        assert.deepEqual(await allCategories(), original, "Os cenários do helper não deixam alterações no runner.");
        assert.equal(await productCount(), originalProducts);
    } finally {
        client.release();
    }
};
