"use strict";

const db = require("../database/connection");

async function produtos(request, response, next) {
    try {
        const { rows } = await db.query(`
            SELECT
                p.id,
                p.nome,
                p.descricao,
                p.preco,
                p.foto,
                p.sku,
                c.nome AS categoria,
                GREATEST(0,COALESCE(e.quantidade,0)-COALESCE(r.quantidade,0)) AS estoque_disponivel
            FROM produtos p
            LEFT JOIN categorias c
                ON c.id = p.categoria_id AND c.empresa_id=p.empresa_id
            LEFT JOIN estoque e ON e.produto_id=p.id AND e.empresa_id=p.empresa_id
            LEFT JOIN LATERAL (SELECT SUM(quantidade) AS quantidade FROM reservas_estoque
                WHERE empresa_id=p.empresa_id AND produto_id=p.id AND confirmada_em IS NULL AND liberada_em IS NULL) r ON TRUE
            WHERE COALESCE(p.status, p.ativo, TRUE) = TRUE
                AND p.empresa_id=get_petflow_empresa_id()
            ORDER BY p.nome ASC
            LIMIT 12;
        `);

        return response.status(200).json({
            success: true,
            data: rows
        });
    } catch (error) {
        next(error);
    }
}

async function categorias(request, response, next) {
    try {
        const { rows } = await db.query(`
            SELECT
                id,
                nome,
                descricao
            FROM categorias
            WHERE COALESCE(status, ativo, TRUE) = TRUE
                AND empresa_id=get_petflow_empresa_id()
            ORDER BY nome ASC;
        `);

        return response.status(200).json({
            success: true,
            data: rows
        });
    } catch (error) {
        next(error);
    }
}

async function servicos(request, response, next) {
    try {
        const { rows } = await db.query(`
            SELECT
                id,
                nome,
                descricao,
                preco,
                duracao
            FROM servicos
            WHERE ativo = TRUE
                AND empresa_id=get_petflow_empresa_id()
            ORDER BY nome ASC
            LIMIT 8;
        `);

        return response.status(200).json({
            success: true,
            data: rows
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    produtos,
    categorias,
    servicos
};
