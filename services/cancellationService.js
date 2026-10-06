"use strict";
const crypto = require("node:crypto"), audit = require("./auditService"), reconciliation = require("./paymentReconciliationService");
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function automaticAllowed(order, tracking, now = Date.now(), env = process.env) {
    if (["ENTREGUE", "FINALIZADA", "CANCELADA"].includes(order.status) || order.entregue_em) return false;
    if (!order.estoque_baixado_em) return true;
    const minutes = Number(env.CANCELLATION_WINDOW_MINUTES || 30), age = now - new Date(order.data_venda).getTime();
    if (!Number.isFinite(age) || age < 0 || !Number.isFinite(minutes) || minutes <= 0 || age > minutes * 60000) return false;
    if (["PAGAMENTO_APROVADO", "EM_SEPARACAO"].includes(order.status)) return true;
    if (order.status !== "SAIU_PARA_ENTREGA" || !tracking) return false;
    const ageGps = now - new Date(tracking.atualizado_em).getTime(), ageRoute = now - new Date(tracking.rota_solicitada_em).getTime();
    const ageObserved=now-new Date(tracking.observado_em).getTime();
    const ageOrigin=tracking.rota?.origem_gps_observado_em?now-new Date(tracking.rota.origem_gps_observado_em).getTime():NaN;
    const minimum = Number(env.CANCELLATION_MIN_DISTANCE_METERS || 1000);
    return Number.isFinite(ageGps) && ageGps >= 0 && ageGps < 15000 && Number.isFinite(ageRoute) && ageRoute >= 0 && ageRoute < 30000 &&
        Number.isFinite(ageObserved) && ageObserved >= 0 && ageObserved < 15000 && Number.isFinite(ageOrigin) && ageOrigin>=0 && ageOrigin<30000 &&
        tracking.precisao_m != null && Number(tracking.precisao_m) >= 0 && Number(tracking.precisao_m) <= 100 && Number.isFinite(minimum) && minimum > 0 &&
        Number(tracking.rota?.distanceMeters) > minimum + 100 + 80 * ageOrigin / 1000;
}
async function openTicket(client, order, reason) {
    const existing = await client.query("SELECT protocolo FROM solicitacoes_consumidor WHERE empresa_id=$1 AND venda_id=$2 AND status IN ('RECEBIDA','EM_ANALISE')", [order.empresa_id, order.id]);
    if (existing.rows[0]) return existing.rows[0].protocolo;
    const protocol = "SAC-" + crypto.randomBytes(10).toString("hex").toUpperCase();
    await client.query(`INSERT INTO solicitacoes_consumidor(protocolo,empresa_id,cliente_id,venda_id,email_referencia,tipo,motivo)
        SELECT $1,$2,$3,$4,c.email,'CANCELAMENTO',$5 FROM clientes c WHERE c.id=$3 AND c.empresa_id=$2`,
        [protocol, order.empresa_id, order.cliente_id, order.id, reason]);
    return protocol;
}
async function createRefund(client, order, actor, { reason, value, purpose = "CANCELAMENTO", returnId = null }) {
    if (!Number.isSafeInteger(value) || value <= 0 || value + Number(order.estornado_centavos || 0) > reconciliation.moneyToCents(order.valor_final)) fail("Valor de reembolso inválido.");
    const { rows } = await client.query(`INSERT INTO reembolsos(empresa_id,venda_id,chave_idempotencia,valor_centavos,motivo,solicitado_por,finalidade,devolucao_id,base_estornada_centavos)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [order.empresa_id, order.id, returnId ? "petflow-return-" + returnId : "petflow-refund-" + order.id, value, reason, actor.user.id, purpose, returnId, Number(order.estornado_centavos || 0)]);
    await client.query("UPDATE vendas SET reembolso_status='SOLICITADO' WHERE id=$1 AND empresa_id=$2", [order.id, order.empresa_id]);
    await audit.record(client, actor, "SOLICITAR_REEMBOLSO", "reembolsos", rows[0].id, null, { status: "SOLICITADO", valor: value, tipo: purpose });
    return rows[0];
}
async function processRefund(db, actor, orderId, refundId, gateway) {
    const principal = actor.user;
    const prepared = await db.transaction(async client => {
        const order = await reconciliation.lockOrder(client, orderId, principal.empresaId);
        const refund = (await client.query("SELECT * FROM reembolsos WHERE id=$1 AND venda_id=$2 AND empresa_id=$3 FOR UPDATE", [refundId, orderId, principal.empresaId])).rows[0];
        if (!refund) fail("Reembolso não encontrado.", 404);
        const complete = { status: refund.finalidade === "DEVOLUCAO" ? "CONCLUIDA" : "CANCELADA", reembolso_id: refund.id };
        if (refund.status === "CONCLUIDO") return { result: complete };
        const evidence = await reconciliation.applyCharge(client, order, await gateway.consultarCobranca(order.pagseguro_charge_id), actor);
        const target = Number(refund.base_estornada_centavos) + Number(refund.valor_centavos);
        if (!evidence.ignorado && evidence.estornado_centavos >= target) return { result: complete };
        if (evidence.ignorado || refund.status !== "SOLICITADO") return { result: { status: "PROCESSANDO", reembolso_id: refund.id, message: "Reembolso aguardando confirmação do PagBank. Consulte novamente." } };
        // O marcador é confirmado antes do POST. Crash entre envio e confirmação
        // deixa PROCESSANDO; outro worker/cliente só consulta, nunca envia de novo.
        await client.query("UPDATE reembolsos SET status='PROCESSANDO',tentativa_em=NOW(),updated_at=NOW() WHERE id=$1 AND empresa_id=$2", [refund.id, order.empresa_id]);
        await client.query("UPDATE vendas SET reembolso_status='PROCESSANDO' WHERE id=$1 AND empresa_id=$2", [order.id, order.empresa_id]);
        await audit.record(client, actor, "INICIAR_REEMBOLSO", "reembolsos", refund.id, { status: refund.status }, { status: "PROCESSANDO", valor: Number(refund.valor_centavos) });
        return { chargeId: order.pagseguro_charge_id, refund };
    });
    if (prepared.result) return prepared.result;
    try {
        const charge = await gateway.reembolsar(prepared.chargeId, Number(prepared.refund.valor_centavos), prepared.refund.chave_idempotencia);
        return await db.transaction(async client => {
            const order = await reconciliation.lockOrder(client, orderId, principal.empresaId);
            const refund = (await client.query("SELECT * FROM reembolsos WHERE id=$1 AND venda_id=$2 AND empresa_id=$3 FOR UPDATE", [refundId, orderId, principal.empresaId])).rows[0];
            if (!refund) fail("Reembolso não encontrado.", 404);
            if (refund.status === "CONCLUIDO") return { status: refund.finalidade === "DEVOLUCAO" ? "CONCLUIDA" : "CANCELADA", reembolso_id: refund.id };
            const evidence = await reconciliation.applyCharge(client, order, charge, actor);
            const target = Number(refund.base_estornada_centavos) + Number(refund.valor_centavos);
            if (evidence.ignorado || evidence.estornado_centavos < target) {
                await client.query("UPDATE reembolsos SET status='PROCESSANDO',updated_at=NOW() WHERE id=$1 AND empresa_id=$2", [refund.id, order.empresa_id]);
                await client.query("UPDATE vendas SET reembolso_status='PROCESSANDO' WHERE id=$1 AND empresa_id=$2", [order.id, order.empresa_id]);
                return { status: "PROCESSANDO", reembolso_id: refund.id, message: "Reembolso aguardando confirmação do PagBank. Consulte novamente." };
            }
            return { status: refund.finalidade === "DEVOLUCAO" ? "CONCLUIDA" : "CANCELADA", reembolso_id: refund.id, notify: refund.finalidade === "CANCELAMENTO" };
        });
    } catch (error) {
        await db.transaction(async client => {
            const order = await reconciliation.lockOrder(client, orderId, principal.empresaId);
            const changed = await client.query("UPDATE reembolsos SET status='INCERTO',updated_at=NOW() WHERE id=$1 AND venda_id=$2 AND empresa_id=$3 AND status<>'CONCLUIDO' RETURNING id", [refundId, orderId, principal.empresaId]);
            if (changed.rows.length) await client.query("UPDATE vendas SET reembolso_status='INCERTO' WHERE id=$1 AND empresa_id=$2", [order.id, principal.empresaId]);
        });
        throw error;
    }
}
async function requestCancellation(db, req, id, gateway) {
    const reason = String(req.body?.motivo || "").trim();
    if (reason.length < 5 || reason.length > 500) fail("Informe um motivo entre 5 e 500 caracteres.");
    const principal = req.user || req.customer;
    const actor = { ...req, user: req.user || { id: null, empresaId: principal.empresaId } };
    const prepared = await db.transaction(async client => {
        const order = await reconciliation.lockOrder(client, id, principal.empresaId);
        if (req.customer && order.cliente_id !== req.customer.id) fail("Pedido não encontrado.", 404);
        if (order.status === "CANCELADA") return { status: "CANCELADA" };
        const existing = await client.query("SELECT * FROM reembolsos WHERE venda_id=$1 AND empresa_id=$2 AND finalidade='CANCELAMENTO'", [id, principal.empresaId]);
        if (existing.rows[0]) return { refund: existing.rows[0] };
        const tracking = order.status === "SAIU_PARA_ENTREGA" ? (await client.query("SELECT * FROM entrega_rastreamento WHERE venda_id=$1", [id])).rows[0] : null;
        if (!automaticAllowed(order, tracking)) return { status: "ATENDIMENTO", protocolo: await openTicket(client, order, reason) };
        if (!order.estoque_baixado_em) {
            await require("./reservationService").release(client, order);
            await client.query("UPDATE vendas SET status='CANCELADA',cancelado_em=NOW(),cancelado_por=$1,cancelamento_motivo=$2 WHERE id=$3 AND empresa_id=$4", [req.user?.id || null, reason, id, principal.empresaId]);
            await audit.record(client, actor, "CANCELAR", "vendas", id, order, { status: "CANCELADA" });
            await reconciliation.queueCustomerEmail(client, order, "CANCELADA");
            return { status: "CANCELADA", notify: true };
        }
        if (!order.pagseguro_charge_id) return { status: "ATENDIMENTO", protocolo: await openTicket(client, order, reason) };
        const disputes = await client.query("SELECT id FROM disputas_pagamento WHERE venda_id=$1 AND empresa_id=$2 AND status_provedor<>'WON'", [id, principal.empresaId]);
        if (disputes.rows.length) return { status: "ATENDIMENTO", protocolo: await openTicket(client, order, reason) };
        const evidence = await reconciliation.applyCharge(client, order, await gateway.consultarCobranca(order.pagseguro_charge_id), actor);
        const remaining = evidence.pago_centavos - evidence.estornado_centavos;
        if (evidence.ignorado || !remaining) return { status: "ATENDIMENTO", protocolo: await openTicket(client, order, reason) };
        const protocol = order.status === "SAIU_PARA_ENTREGA" ? await openTicket(client, order, reason + " — Conferir recebimento físico dos produtos após o cancelamento.") : undefined;
        return { refund: await createRefund(client, order, actor, { reason, value: remaining }), protocolo: protocol };
    });
    if (!prepared.refund) return prepared;
    return { ...await processRefund(db, actor, id, prepared.refund.id, gateway), ...(prepared.protocolo ? { protocolo: prepared.protocolo } : {}) };
}
module.exports = { automaticAllowed, requestCancellation, createRefund, processRefund };
