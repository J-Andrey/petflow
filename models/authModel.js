"use strict";
const db = require("../database/connection");
const { hashToken } = require("../services/sessionService");
async function findByEmail(email) {
    const { rows } = await db.query(`SELECT id, empresa_id, nome, email, senha_hash AS senha,
        perfil AS cargo, ativo AS status, sessao_versao FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    return rows[0] || null;
}
async function findById(id, empresaId) {
    const { rows } = await db.query(`SELECT id, empresa_id, nome, email, perfil AS cargo,
        ativo AS status, sessao_versao FROM usuarios WHERE id=$1 AND empresa_id=$2`, [id, empresaId]);
    return rows[0] || null;
}
async function updateLastLogin(id) { await db.query("UPDATE usuarios SET ultimo_login=NOW() WHERE id=$1", [id]); }
async function revokeSessions(id, empresaId) {
    await db.query("UPDATE usuarios SET sessao_versao=sessao_versao+1 WHERE id=$1 AND empresa_id=$2", [id, empresaId]);
}
async function setPasswordResetToken(id, token, expiresAt) {
    await db.query("UPDATE usuarios SET token_recuperacao=$1, token_expiracao=$2 WHERE id=$3 AND ativo=TRUE", [hashToken(token), expiresAt, id]);
}
async function consumePasswordResetToken(token, senhaHash) {
    const { rowCount } = await db.query(`UPDATE usuarios SET senha_hash=$1, token_recuperacao=NULL,
        token_expiracao=NULL, sessao_versao=sessao_versao+1
        WHERE token_recuperacao=$2 AND token_expiracao>NOW() AND ativo=TRUE`, [senhaHash, hashToken(token)]);
    return rowCount === 1;
}
module.exports = { findByEmail, findById, updateLastLogin, revokeSessions, setPasswordResetToken, consumePasswordResetToken };
