"use strict";
const router = require("express").Router(), db = require("../database/connection");
const role = require("../middlewares/roleMiddleware"), gateway = require("../services/pagseguroService");
const reconciliation = require("../services/paymentReconciliationService"), returns = require("../services/returnService");
const { UUID } = require("../services/sessionService");
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const page = req => Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
router.use(require("../middlewares/authMiddleware"));
router.param("id", (req, res, next, id) => UUID.test(id) ? next() : res.status(400).json({ success: false, message: "Identificador inválido." }));
router.get("/conciliacao", role("ADMIN", "GERENTE"), wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT v.id,v.status,v.valor_final,v.estornado_centavos,v.conciliacao_status,v.conciliacao_resposta,
        v.reembolso_status,v.pagseguro_charge_id,c.nome AS cliente,COUNT(*) OVER() AS total,
        COALESCE((SELECT json_agg(json_build_object('id',d.provedor_id,'status',d.status_provedor,'valor_centavos',d.valor_centavos,'perda_centavos',d.perda_centavos))
            FROM disputas_pagamento d WHERE d.venda_id=v.id AND d.empresa_id=v.empresa_id),'[]'::json) AS disputas
        FROM vendas v LEFT JOIN clientes c ON c.id=v.cliente_id AND c.empresa_id=v.empresa_id
        WHERE v.empresa_id=$1 AND (v.id::text ILIKE $2 OR c.nome ILIKE $2)
        AND (v.conciliacao_status<>'SEM_PENDENCIA' OR v.reembolso_status IN ('INCERTO','PROCESSANDO','SOLICITADO'))
        ORDER BY v.updated_at DESC,v.id LIMIT 25 OFFSET $3`,
        [req.user.empresaId, "%" + String(req.query.q || "").slice(0, 100) + "%", (page(req) - 1) * 25]);
    res.json({ success: true, data: rows, page: page(req) });
}));
router.get("/conciliacao/:id", role("ADMIN", "GERENTE"), wrap(async (req, res) => {
    const order = (await db.query("SELECT id,status,valor_final,estornado_centavos,conciliacao_status,conciliacao_resposta FROM vendas WHERE id=$1 AND empresa_id=$2", [req.params.id, req.user.empresaId])).rows[0];
    if (!order) return res.status(404).json({ success: false, message: "Pedido não encontrado." });
    const events = await db.query("SELECT * FROM conciliacao_eventos WHERE venda_id=$1 AND empresa_id=$2 ORDER BY criado_em,id", [req.params.id, req.user.empresaId]);
    const refunds = await db.query("SELECT id,status,finalidade,valor_centavos,base_estornada_centavos,motivo,created_at,updated_at FROM reembolsos WHERE venda_id=$1 AND empresa_id=$2 ORDER BY created_at,id", [req.params.id, req.user.empresaId]);
    res.json({ success: true, data: { ...order, eventos: events.rows, reembolsos: refunds.rows } });
}));
router.post("/conciliacao/:id/consultar", role("ADMIN"), wrap(async (req, res) => res.json({ success: true, data: await reconciliation.reconcile(db, req, req.params.id, gateway) })));
router.patch("/conciliacao/:id/revisar", role("ADMIN"), wrap(async (req, res) => res.json({ success: true, data: await reconciliation.review(db, req, req.params.id) })));
router.get("/devolucoes", role("ADMIN", "GERENTE"), wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT d.*,s.protocolo,c.nome AS cliente,r.status AS reembolso_status,COUNT(*) OVER() AS total,
        COALESCE((SELECT json_agg(json_build_object('produto_id',i.produto_id,'produto',p.nome,'quantidade',i.quantidade,'repor_estoque',i.repor_estoque) ORDER BY i.produto_id)
            FROM devolucao_itens i JOIN produtos p ON p.id=i.produto_id AND p.empresa_id=d.empresa_id WHERE i.devolucao_id=d.id),'[]'::json) AS itens
        FROM devolucoes d JOIN solicitacoes_consumidor s ON s.id=d.solicitacao_id AND s.empresa_id=d.empresa_id
        JOIN vendas v ON v.id=d.venda_id AND v.empresa_id=d.empresa_id
        LEFT JOIN clientes c ON c.id=v.cliente_id AND c.empresa_id=v.empresa_id
        LEFT JOIN reembolsos r ON r.devolucao_id=d.id AND r.empresa_id=d.empresa_id
        WHERE d.empresa_id=$1 AND (s.protocolo ILIKE $2 OR d.venda_id::text ILIKE $2 OR c.nome ILIKE $2)
        ORDER BY d.aprovada_em DESC,d.id LIMIT 25 OFFSET $3`, [req.user.empresaId, "%" + String(req.query.q || "").slice(0, 100) + "%", (page(req) - 1) * 25]);
    res.json({ success: true, data: rows, page: page(req) });
}));
router.get("/devolucoes/solicitacao/:id", role("ADMIN", "GERENTE"), wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT s.id,s.protocolo,s.status,s.tipo,v.id AS venda_id,v.status AS pedido_status,v.valor_final,v.estornado_centavos
        FROM solicitacoes_consumidor s JOIN vendas v ON v.id=s.venda_id AND v.empresa_id=s.empresa_id WHERE s.id=$1 AND s.empresa_id=$2`, [req.params.id, req.user.empresaId]);
    if (!rows[0]) return res.status(404).json({ success: false, message: "Solicitação não encontrada." });
    const items = await db.query(`SELECT i.produto_id,p.nome AS produto,SUM(i.quantidade)::integer AS quantidade,
        COALESCE((SELECT SUM(di.quantidade) FROM devolucao_itens di JOIN devolucoes d ON d.id=di.devolucao_id
            WHERE d.venda_id=$1 AND d.empresa_id=$2 AND di.produto_id=i.produto_id),0)::integer AS quantidade_devolvida
        FROM itens_venda i JOIN produtos p ON p.id=i.produto_id AND p.empresa_id=i.empresa_id
        WHERE i.venda_id=$1 AND i.empresa_id=$2 GROUP BY i.produto_id,p.nome ORDER BY p.nome,i.produto_id`, [rows[0].venda_id, req.user.empresaId]);
    res.json({ success: true, data: { ...rows[0], itens: items.rows } });
}));
router.post("/devolucoes/solicitacao/:id/aprovar", role("ADMIN"), wrap(async (req, res) => res.status(201).json({ success: true, data: await returns.approve(db, req, req.params.id, gateway) })));
router.post("/devolucoes/:id/receber", role("ADMIN"), wrap(async (req, res) => res.json({ success: true, data: await returns.receive(db, req, req.params.id) })));
router.post("/devolucoes/:id/reembolsar", role("ADMIN"), wrap(async (req, res) => res.json({ success: true, data: await returns.refund(db, req, req.params.id, gateway) })));
module.exports = router;
