"use strict";
const audit = require("./auditService"), reconciliation = require("./paymentReconciliationService"), refunds = require("./cancellationService");
const { UUID } = require("./sessionService");
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function validateItems(items, receiving = false) {
    if (!Array.isArray(items) || !items.length || items.length > 100) fail("Informe os produtos da devolução.");
    const seen = new Set();
    return items.map(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) fail("Item de devolução inválido.");
        if (!UUID.test(item.produto_id) || seen.has(item.produto_id)) fail("Produto inválido ou repetido.");
        seen.add(item.produto_id);
        if (receiving ? typeof item.repor_estoque !== "boolean" : !Number.isSafeInteger(item.quantidade) || item.quantidade <= 0) fail(receiving ? "Confirme a condição de cada produto recebido." : "Quantidade devolvida inválida.");
        return receiving ? { produto_id: item.produto_id, repor_estoque: item.repor_estoque } : { produto_id: item.produto_id, quantidade: item.quantidade };
    });
}
async function approve(db, req, ticketId, gateway) {
    const data = req.body || {}, items = validateItems(data.itens);
    if (!Number.isSafeInteger(data.valor_centavos) || data.valor_centavos < 0 || typeof data.motivo !== "string" || data.motivo.trim().length < 5 || data.motivo.length > 500) fail("Informe valor em centavos e motivo entre 5 e 500 caracteres.");
    return db.transaction(async client => {
        const reference = (await client.query("SELECT venda_id FROM solicitacoes_consumidor WHERE id=$1 AND empresa_id=$2", [ticketId, req.user.empresaId])).rows[0];
        if (!reference) fail("Solicitação não encontrada.", 404);
        const order = await reconciliation.lockOrder(client, reference.venda_id, req.user.empresaId);
        const ticket = (await client.query("SELECT * FROM solicitacoes_consumidor WHERE id=$1 AND empresa_id=$2 FOR UPDATE", [ticketId, req.user.empresaId])).rows[0];
        const existing = (await client.query("SELECT * FROM devolucoes WHERE solicitacao_id=$1 AND empresa_id=$2", [ticketId, req.user.empresaId])).rows[0];
        if (existing) return existing;
        if (!["RECEBIDA", "EM_ANALISE"].includes(ticket.status) || !["DEVOLUCAO", "ARREPENDIMENTO", "CANCELAMENTO"].includes(ticket.tipo)) fail("Solicitação não está aberta para devolução.", 409);
        if (!order.estoque_baixado_em || order.estoque_devolvido_em || !order.pagseguro_charge_id || !(order.entregue_em || ["ENTREGUE", "FINALIZADA", "SAIU_PARA_ENTREGA", "CANCELADA"].includes(order.status))) fail("Pedido não elegível para devolução administrativa.", 409);
        const disputes = await client.query("SELECT id FROM disputas_pagamento WHERE venda_id=$1 AND empresa_id=$2 AND status_provedor<>'WON'", [order.id, order.empresa_id]);
        if (disputes.rows.length) fail("Pedido em disputa. Concilie antes de aprovar um reembolso.", 409);
        const active = await client.query("SELECT id FROM reembolsos WHERE venda_id=$1 AND empresa_id=$2 AND status<>'CONCLUIDO'", [order.id, order.empresa_id]);
        if (active.rows.length) fail("Pedido com reembolso pendente.", 409);
        const charge = await reconciliation.applyCharge(client, order, await gateway.consultarCobranca(order.pagseguro_charge_id), req);
        const committed = (await client.query("SELECT COALESCE(SUM(valor_centavos),0)::text AS valor FROM devolucoes WHERE venda_id=$1 AND empresa_id=$2 AND status<>'CONCLUIDA'", [order.id, order.empresa_id])).rows[0];
        if (charge.ignorado || data.valor_centavos + Number(committed.valor) > charge.pago_centavos - charge.estornado_centavos) fail("Valor excede o saldo reembolsável do pedido.", 409);
        const quantities = await client.query(`SELECT i.produto_id,SUM(i.quantidade)::integer AS vendida,
            COALESCE((SELECT SUM(di.quantidade) FROM devolucao_itens di JOIN devolucoes d ON d.id=di.devolucao_id
                WHERE d.venda_id=$1 AND d.empresa_id=$2 AND di.produto_id=i.produto_id),0)::integer AS devolvida
            FROM itens_venda i WHERE i.venda_id=$1 AND i.empresa_id=$2 GROUP BY i.produto_id`, [order.id, order.empresa_id]);
        for (const item of items) {
            const original = quantities.rows.find(q => q.produto_id === item.produto_id);
            if (!original || item.quantidade > original.vendida - original.devolvida) fail("Quantidade excede os produtos disponíveis para devolução.", 409);
        }
        const { rows } = await client.query(`INSERT INTO devolucoes(empresa_id,venda_id,solicitacao_id,valor_centavos,motivo,aprovada_por)
            VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [order.empresa_id, order.id, ticketId, data.valor_centavos, data.motivo.trim(), req.user.id]);
        for (const item of items) await client.query("INSERT INTO devolucao_itens(devolucao_id,produto_id,quantidade) VALUES($1,$2,$3)", [rows[0].id, item.produto_id, item.quantidade]);
        await client.query("UPDATE solicitacoes_consumidor SET status='EM_ANALISE',resposta=$1,atendida_por=$2,updated_at=NOW() WHERE id=$3 AND empresa_id=$4", ["Devolução aprovada. Aguardando recebimento físico e confirmação do reembolso.", req.user.id, ticketId, order.empresa_id]);
        await audit.record(client, req, "APROVAR_DEVOLUCAO", "devolucoes", rows[0].id, null, { status: "APROVADA", valor: data.valor_centavos, descricao: JSON.stringify(items) });
        return { ...rows[0], itens: items };
    });
}
async function lockReturn(client, req, id) {
    const reference = (await client.query("SELECT venda_id FROM devolucoes WHERE id=$1 AND empresa_id=$2", [id, req.user.empresaId])).rows[0];
    if (!reference) fail("Devolução não encontrada.", 404);
    const order = await reconciliation.lockOrder(client, reference.venda_id, req.user.empresaId);
    const item = (await client.query("SELECT * FROM devolucoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE", [id, req.user.empresaId])).rows[0];
    return { order, item };
}
async function receive(db, req, id) {
    const data = req.body || {}, items = validateItems(data.itens, true);
    if (typeof data.observacao !== "string" || data.observacao.trim().length < 5 || data.observacao.length > 1000) fail("Registre o recebimento físico entre 5 e 1000 caracteres.");
    return db.transaction(async client => {
        const { order, item } = await lockReturn(client, req, id);
        if (item.recebida_em) return item;
        if (item.status !== "APROVADA") fail("Devolução não está aguardando recebimento.", 409);
        const approved = (await client.query("SELECT * FROM devolucao_itens WHERE devolucao_id=$1 ORDER BY produto_id", [id])).rows;
        if (approved.length !== items.length || approved.some(a => !items.find(i => i.produto_id === a.produto_id))) fail("Confirme a condição de todos os itens aprovados.");
        await client.query("SELECT set_config('petflow.referencia_tipo','DEVOLUCAO',TRUE),set_config('petflow.referencia_id',$1,TRUE)", [id]);
        for (const product of approved) {
            const restock = items.find(i => i.produto_id === product.produto_id).repor_estoque;
            if (restock) {
                const stock = await client.query("UPDATE estoque SET quantidade=quantidade+$1 WHERE empresa_id=$2 AND produto_id=$3 RETURNING produto_id", [product.quantidade, order.empresa_id, product.produto_id]);
                if (!stock.rows[0]) fail("Estoque do produto não encontrado.", 409);
            }
            await client.query("UPDATE devolucao_itens SET repor_estoque=$1 WHERE devolucao_id=$2 AND produto_id=$3", [restock, id, product.produto_id]);
        }
        const status = Number(item.valor_centavos) === 0 ? "CONCLUIDA" : "RECEBIDA";
        const { rows } = await client.query("UPDATE devolucoes SET status=$1::text,recebida_por=$2,recebida_em=NOW(),recebimento_observacao=$3,concluida_em=CASE WHEN $1::text='CONCLUIDA' THEN NOW() ELSE NULL END WHERE id=$4 AND empresa_id=$5 RETURNING *", [status, req.user.id, data.observacao.trim(), id, order.empresa_id]);
        if (status === "CONCLUIDA") {
            await client.query("UPDATE solicitacoes_consumidor SET status='ATENDIDA',resposta='Devolução recebida sem novo reembolso, conforme análise administrativa.',atendida_por=$1,atendida_em=NOW(),updated_at=NOW() WHERE id=$2 AND empresa_id=$3", [req.user.id, item.solicitacao_id, order.empresa_id]);
            await reconciliation.queueCustomerEmail(client, order, "SEM_REEMBOLSO", id);
        }
        await audit.record(client, req, "RECEBER_DEVOLUCAO", "devolucoes", id, { status: item.status }, { status, descricao: JSON.stringify({ itens: items, observacao: data.observacao.trim() }) });
        return rows[0];
    });
}
async function refund(db, req, id, gateway) {
    const prepared = await db.transaction(async client => {
        const { order, item } = await lockReturn(client, req, id);
        if (!item.recebida_em) fail("Confirme o recebimento físico antes de solicitar reembolso.", 409);
        if (Number(item.valor_centavos) === 0) return { result: { status: "CONCLUIDA", sem_novo_reembolso: true } };
        const existing = (await client.query("SELECT * FROM reembolsos WHERE devolucao_id=$1 AND empresa_id=$2", [id, order.empresa_id])).rows[0];
        if (existing) return { orderId: order.id, refundId: existing.id };
        const active = await client.query("SELECT id FROM reembolsos WHERE venda_id=$1 AND empresa_id=$2 AND status<>'CONCLUIDO'", [order.id, order.empresa_id]);
        if (active.rows.length) fail("Há outro reembolso pendente para o pedido.", 409);
        const dispute = await client.query("SELECT id FROM disputas_pagamento WHERE venda_id=$1 AND empresa_id=$2 AND status_provedor<>'WON'", [order.id, order.empresa_id]);
        if (dispute.rows.length) fail("Pedido em disputa. Concilie antes de reembolsar.", 409);
        const charge = await reconciliation.applyCharge(client, order, await gateway.consultarCobranca(order.pagseguro_charge_id), req);
        if (charge.ignorado || Number(item.valor_centavos) > charge.pago_centavos - charge.estornado_centavos) fail("Saldo reembolsável divergente; revise a conciliação.", 409);
        const created = await refunds.createRefund(client, order, req, { reason: item.motivo, value: Number(item.valor_centavos), purpose: "DEVOLUCAO", returnId: id });
        await client.query("UPDATE devolucoes SET status='REEMBOLSO_SOLICITADO' WHERE id=$1 AND empresa_id=$2", [id, order.empresa_id]);
        return { orderId: order.id, refundId: created.id };
    });
    return prepared.result || refunds.processRefund(db, req, prepared.orderId, prepared.refundId, gateway);
}
module.exports = { validateItems, approve, receive, refund };
