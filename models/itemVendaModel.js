"use strict";

/* ==================================================
   DEPENDÊNCIAS
================================================== */

const db = require("../database/connection");

/* ==================================================
   MODEL
================================================== */

class ItemVendaModel {

    /* ==========================
       LISTAR ITENS DA VENDA
    ========================== */

    static async listar(vendaId, empresaId) {

        const query = `
            SELECT
                iv.*,
                p.nome AS produto
            FROM itens_venda iv
            INNER JOIN vendas v
                ON v.id = iv.venda_id
            INNER JOIN produtos p
                ON p.id = iv.produto_id
            WHERE iv.venda_id = $1
              AND v.empresa_id = $2
            ORDER BY iv.created_at ASC;
        `;

        const { rows } = await db.query(query, [
            vendaId,
            empresaId
        ]);

        return rows;

    }

    /* ==========================
       BUSCAR POR ID
    ========================== */

    static async buscarPorId(id, empresaId) {

        const query = `
            SELECT
                iv.*
            FROM itens_venda iv
            INNER JOIN vendas v
                ON v.id = iv.venda_id
            WHERE iv.id = $1
              AND v.empresa_id = $2
            LIMIT 1;
        `;

        const { rows } = await db.query(query, [
            id,
            empresaId
        ]);

        return rows[0];

    }

    /* ==========================
       CADASTRAR
    ========================== */

    static async criar(dados, client = db) {

        const query = `
            INSERT INTO itens_venda (
                venda_id,
                produto_id,
                quantidade,
                preco_unitario,
                desconto,
                subtotal,
                empresa_id
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                (SELECT empresa_id FROM vendas WHERE id=$1)
            )
            RETURNING *;
        `;

        const quantidade = Number(dados.quantidade ?? 0);

        const precoUnitario = Number(
            dados.precoUnitario ??
            dados.preco_unitario ??
            dados.valorUnitario ??
            dados.valor_unitario ??
            0
        );

        const desconto = Number(dados.desconto ?? 0);

        const subtotal = Number(
            dados.subtotal ??
            (quantidade * precoUnitario - desconto)
        );

        const values = [
            dados.vendaId ?? dados.venda_id,
            dados.produtoId ?? dados.produto_id,
            quantidade,
            precoUnitario,
            desconto,
            subtotal
        ];

        const { rows } = await client.query(query, values);

        return rows[0];

    }

    /* ==========================
       ATUALIZAR
    ========================== */

    static async atualizar(id, empresaId, dados, client = db) {

        const query = `
            UPDATE itens_venda AS iv
            SET
                produto_id = $1,
                quantidade = $2,
                preco_unitario = $3,
                desconto = $4,
                subtotal = $5,
                updated_at = CURRENT_TIMESTAMP
            FROM vendas AS v
            WHERE iv.id = $6
              AND v.id = iv.venda_id
              AND v.empresa_id = $7
            RETURNING iv.*;
        `;

        const quantidade = Number(dados.quantidade ?? 0);

        const precoUnitario = Number(
            dados.precoUnitario ??
            dados.preco_unitario ??
            dados.valorUnitario ??
            dados.valor_unitario ??
            0
        );

        const desconto = Number(dados.desconto ?? 0);

        const subtotal = Number(
            dados.subtotal ??
            (quantidade * precoUnitario - desconto)
        );

        const values = [
            dados.produtoId ?? dados.produto_id,
            quantidade,
            precoUnitario,
            desconto,
            subtotal,
            id,
            empresaId
        ];

        const { rows } = await client.query(query, values);

        return rows[0];

    }

    /* ==========================
       EXCLUIR
    ========================== */

    static async excluir(id, empresaId, client = db) {

        const query = `
            DELETE FROM itens_venda AS iv
            USING vendas AS v
            WHERE iv.id = $1
              AND v.id = iv.venda_id
              AND v.empresa_id = $2
            RETURNING iv.*;
        `;

        const { rows } = await client.query(query, [
            id,
            empresaId
        ]);

        return rows[0];

    }

}

module.exports = ItemVendaModel;