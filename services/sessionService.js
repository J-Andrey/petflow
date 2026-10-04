"use strict";
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validPassword(value) {
    return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 8 && Buffer.byteLength(value, "utf8") <= 72;
}
function hashToken(token) { return crypto.createHash("sha256").update(String(token)).digest("hex"); }
function signSession(account, type, secret, expiresIn = "7d") {
    return jwt.sign({
        id: account.id, empresaId: account.empresa_id, type,
        perfil: type === "admin" ? account.perfil || account.cargo : "CLIENTE",
        sessao_versao: account.sessao_versao
    }, secret, { algorithm: "HS256", expiresIn, issuer: "petflow", audience: `petflow:${type}` });
}
function createSessionMiddleware({ db, secret, type }) {
    return async (request, response, next) => {
        let decoded;
        try {
            const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || "");
            if (!match) throw new Error("token");
            decoded = jwt.verify(match[1], secret, {
                algorithms: ["HS256"], issuer: "petflow", audience: `petflow:${type}`
            });
            if (decoded.type !== type || !UUID.test(decoded.id) || !UUID.test(decoded.empresaId) ||
                !Number.isInteger(decoded.sessao_versao) || !Number.isInteger(decoded.exp)) throw new Error("claims");
        } catch {
            return response.status(401).json({ success: false, message: "Sessão inválida ou expirada. Faça login novamente." });
        }
        try {
            const sql = type === "admin"
                ? `SELECT id, empresa_id, nome, email, perfil, sessao_versao FROM usuarios
                   WHERE id = $1 AND empresa_id = $2 AND ativo = TRUE`
                : `SELECT c.id, c.empresa_id, c.nome, c.email, 'CLIENTE' AS perfil, uc.sessao_versao
                   FROM clientes c JOIN usuarios_clientes uc ON uc.cliente_id = c.id
                   WHERE c.id = $1 AND c.empresa_id = $2 AND c.ativo = TRUE
                     AND uc.ativo = TRUE AND uc.email_verificado = TRUE AND c.anonimizado_em IS NULL`;
            const { rows } = await db.query(sql, [decoded.id, decoded.empresaId]);
            const account = rows[0];
            if (!account || account.sessao_versao !== decoded.sessao_versao || account.perfil !== decoded.perfil ||
                (type === "admin" && !["ADMIN", "GERENTE"].includes(account.perfil))) {
                return response.status(401).json({ success: false, message: "Sessão revogada. Faça login novamente." });
            }
            const principal = { ...account, empresaId: account.empresa_id, cargo: account.perfil, type };
            if (type === "admin") request.usuario = request.user = principal;
            else request.customer = principal;
            return next();
        } catch (error) { return next(error); }
    };
}
module.exports = { UUID, validPassword, hashToken, signSession, createSessionMiddleware };
