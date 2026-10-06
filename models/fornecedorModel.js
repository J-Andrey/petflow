"use strict";
const db = require("../database/connection");
async function listar(empresaId) {
    return (await db.query("SELECT * FROM fornecedores WHERE empresa_id=$1 AND ativo=TRUE ORDER BY nome,id", [empresaId])).rows;
}
async function buscarPorId(id, empresaId) {
    return (await db.query("SELECT * FROM fornecedores WHERE id=$1 AND empresa_id=$2", [id, empresaId])).rows[0];
}
async function criar(dados) {
    return (await db.query(`INSERT INTO fornecedores(empresa_id,nome,razao_social,nome_fantasia,cnpj,telefone,email,endereco)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [dados.empresa_id,dados.nome,dados.razao_social || dados.nome,
        dados.nome_fantasia || dados.nome,dados.cnpj,dados.telefone,dados.email,dados.endereco])).rows[0];
}
async function atualizar(id, empresaId, dados) {
    return (await db.query(`UPDATE fornecedores SET nome=$1,razao_social=$2,nome_fantasia=$3,cnpj=$4,telefone=$5,
        email=$6,endereco=$7,updated_at=NOW() WHERE id=$8 AND empresa_id=$9 RETURNING *`,
        [dados.nome,dados.razao_social || dados.nome,dados.nome_fantasia || dados.nome,dados.cnpj,
        dados.telefone,dados.email,dados.endereco,id,empresaId])).rows[0];
}
async function excluir(id, empresaId) {
    // Preserva vínculos com compras e produtos, inclusive em operações concorrentes.
    return (await db.query("UPDATE fornecedores SET ativo=FALSE,updated_at=NOW() WHERE id=$1 AND empresa_id=$2 RETURNING *", [id,empresaId])).rows[0];
}
module.exports = { listar, buscarPorId, criar, atualizar, excluir };

