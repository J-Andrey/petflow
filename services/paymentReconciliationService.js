"use strict";
const crypto = require("node:crypto");
const audit = require("./auditService");
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const actorFor = order => ({ user: { id: null, empresaId: order.empresa_id } });

function cents(value, name = "Valor") {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(name + " inválido em centavos.", 502);
    return value;
}
function moneyToCents(value) {
    if (typeof value !== "string" && typeof value !== "number") fail("Valor monetário inválido.");
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
    if (!match) fail("Valor monetário inválido.");
    const result = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    if (!Number.isSafeInteger(result)) fail("Valor monetário inválido.");
    return result;
}
function validateCharge(order, charge) {
    if (!order.pagseguro_charge_id || charge?.id !== order.pagseguro_charge_id) fail("Cobrança divergente do pedido.", 502);
    const total = cents(charge.amount?.summary?.total, "Total da cobrança");
    const paid = cents(charge.amount?.summary?.paid, "Total pago");
    const refunded = cents(charge.amount?.summary?.refunded, "Total estornado");
    if (charge.amount?.currency !== "BRL" || cents(charge.amount?.value) !== total || total !== moneyToCents(order.valor_final) || paid > total || refunded > paid)
        fail("Resumo da cobrança divergente do pedido.", 502);
    // reference_id da cobrança pode diferir da referência do pedido no Checkout.
    // O vínculo comprovado é o charge_id persistido na venda e seu total/moeda.
    return { charge_id: charge.id, status: String(charge.status || ""), total_centavos: total, pago_centavos: paid, estornado_centavos: refunded, moeda: "BRL" };
}
async function addEvent(client, order, type, providerId, value, evidence) {
    const key = crypto.createHash("sha256").update(JSON.stringify([order.id, type, evidence])).digest("hex");
    const { rows } = await client.query(`INSERT INTO conciliacao_eventos(empresa_id,venda_id,tipo,provedor_id,chave_evidencia,valor_centavos,evidencia)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(chave_evidencia) DO NOTHING RETURNING *`,
        [order.empresa_id, order.id, type, providerId, key, value, evidence]);
    return rows[0];
}
async function addLedger(client, order, event, origin, type, value) {
    if (!event || !value) return;
    const { rows } = await client.query(`INSERT INTO financeiro(empresa_id,tipo,origem,referencia_id,descricao,valor,valor_pago,data_vencimento,data_pagamento,status)
        VALUES($1,$2,$3,$4,$5,$6::bigint/100.0,$6::bigint/100.0,CURRENT_DATE,CURRENT_DATE,'PAGO')
        RETURNING id`, [order.empresa_id, type, origin, event.id, origin + " pedido #" + order.id, value]);
    await client.query("UPDATE conciliacao_eventos SET financeiro_id=$1 WHERE id=$2 AND empresa_id=$3", [rows[0].id, event.id, order.empresa_id]);
}
async function flagReview(client, order, message) {
    await client.query("UPDATE vendas SET conciliacao_status='PENDENTE',conciliada_em=NULL,conciliada_por=NULL WHERE id=$1 AND empresa_id=$2", [order.id, order.empresa_id]);
    await client.query(`INSERT INTO notificacoes_admin(empresa_id,cliente_id,venda_id,titulo,mensagem)
        SELECT $1,$2,$3,'Pagamento exige conciliação',$4
        WHERE NOT EXISTS(SELECT 1 FROM notificacoes_admin WHERE empresa_id=$1 AND venda_id=$3 AND titulo='Pagamento exige conciliação' AND mensagem=$4)`,
        [order.empresa_id, order.cliente_id, order.id, message]);
}
async function queueCustomerEmail(client, order, status, returnId) {
    const { rows } = await client.query("SELECT nome,email FROM clientes WHERE id=$1 AND empresa_id=$2", [order.cliente_id, order.empresa_id]);
    if (!rows[0]) return;
    const email = require("./emailService");
    const template = returnId ? status === "SEM_REEMBOLSO" ? { subject: "PetFlow: devolução recebida", text: "Os produtos da devolução no pedido #" + order.id + " foram recebidos. Seu atendimento foi concluído sem novo reembolso, conforme análise administrativa." } : { subject: "PetFlow: devolução reembolsada", text: "O reembolso da sua devolução no pedido #" + order.id + " foi confirmado pelo PagBank. O prazo de crédito depende do meio de pagamento." } : email.orderCanceledTemplate({ name: rows[0].nome, orderId: order.id });
    if(returnId) await client.query("INSERT INTO notificacoes(cliente_id,venda_id,titulo,mensagem,tipo,chave_evento) VALUES($1,$2,$3,$4,'SISTEMA',$5) ON CONFLICT(cliente_id,chave_evento) WHERE chave_evento IS NOT NULL DO NOTHING",[order.cliente_id,order.id,template.subject,template.text,"return-refund-"+returnId]);
    if (!rows[0].email) return;
    await email.enqueueEmail({ empresaId: order.empresa_id, to: rows[0].email, ...template, idempotencyKey: returnId ? "return-refund-" + returnId : "cancel-" + order.id }, client);
}

// Recebe uma consulta autenticada ao provedor, nunca valores de formulário/webhook.
// O chamador mantém FOR UPDATE da venda: serializa estornos e concorrência administrativa.
async function applyCharge(client, order, charge, actor = actorFor(order)) {
    const evidence = validateCharge(order, charge);
    const previous = Number(order.estornado_centavos || 0);
    if (evidence.estornado_centavos < previous) {
        const event = await addEvent(client, order, "CONSULTA", charge.id, 0, evidence);
        if (event) await flagReview(client, order, "Consulta apresentou total estornado menor que o já conciliado. Confira no PagBank.");
        return { ...evidence, ignorado: true };
    }
    const delta = evidence.estornado_centavos - previous;
    const event = await addEvent(client, order, delta ? "ESTORNO" : "CONSULTA", charge.id, delta, evidence);
    if (delta) {
        await addLedger(client, order, event, "ESTORNO", "PAGAR", delta);
        await client.query("UPDATE vendas SET estornado_centavos=$1 WHERE id=$2 AND empresa_id=$3", [evidence.estornado_centavos, order.id, order.empresa_id]);
        order.estornado_centavos = evidence.estornado_centavos;
        await flagReview(client, order, "Estorno confirmado: " + evidence.estornado_centavos + " centavos acumulados. Revise a entrega e o atendimento.");
        await audit.record(client, actor, "CONCILIAR_ESTORNO", "vendas", order.id, { valor: previous }, { valor: evidence.estornado_centavos, status: evidence.status });
    }
    // Somente uma solicitação ativa por pedido; total-alvo é base anterior + valor solicitado.
    const refunds = await client.query("SELECT * FROM reembolsos WHERE venda_id=$1 AND empresa_id=$2 AND status<>'CONCLUIDO' FOR UPDATE", [order.id, order.empresa_id]);
    for (const refund of refunds.rows) {
        const target = Number(refund.base_estornada_centavos || 0) + Number(refund.valor_centavos);
        if (evidence.estornado_centavos < target) continue;
        await client.query("UPDATE reembolsos SET status='CONCLUIDO',provedor_id=$1,updated_at=NOW() WHERE id=$2 AND empresa_id=$3", [charge.id, refund.id, order.empresa_id]);
        await client.query("UPDATE vendas SET reembolso_status='CONCLUIDO',reembolso_id=$1 WHERE id=$2 AND empresa_id=$3", [charge.id, order.id, order.empresa_id]);
        if (refund.finalidade === "DEVOLUCAO") {
            await client.query("UPDATE devolucoes SET status='CONCLUIDA',concluida_em=NOW() WHERE id=$1 AND empresa_id=$2 AND recebida_em IS NOT NULL", [refund.devolucao_id, order.empresa_id]);
            await client.query(`UPDATE solicitacoes_consumidor SET status='ATENDIDA',resposta='Devolução recebida e reembolso confirmado pelo PagBank.',atendida_em=NOW(),updated_at=NOW()
                WHERE empresa_id=$1 AND id=(SELECT solicitacao_id FROM devolucoes WHERE id=$2 AND empresa_id=$1)`, [order.empresa_id, refund.devolucao_id]);
            await queueCustomerEmail(client, order, "CONCLUIDA", refund.devolucao_id);
            await audit.record(client, actor, "REEMBOLSAR_DEVOLUCAO", "devolucoes", refund.devolucao_id, { status: refund.status }, { status: "CONCLUIDA", valor: Number(refund.valor_centavos) });
        } else {
            // Só cancelamentos iniciados antes da saída física podem repor estoque.
            // Em rota, a devolução exige um recebimento explícito pela administração.
            if (!order.entregue_em && ["PAGAMENTO_APROVADO", "EM_SEPARACAO"].includes(order.status) && !order.estoque_devolvido_em) {
                await client.query("SELECT set_config('petflow.referencia_tipo','REEMBOLSO',TRUE),set_config('petflow.referencia_id',$1,TRUE)", [order.id]);
                const items = await client.query("SELECT produto_id,quantidade FROM itens_venda WHERE venda_id=$1 AND empresa_id=$2 ORDER BY produto_id", [order.id, order.empresa_id]);
                for (const item of items.rows) {
                    const stock = await client.query("UPDATE estoque SET quantidade=quantidade+$1 WHERE empresa_id=$2 AND produto_id=$3 RETURNING produto_id", [item.quantidade, order.empresa_id, item.produto_id]);
                    if (!stock.rows[0]) fail("Estoque do produto não encontrado.", 409);
                }
                await client.query("UPDATE vendas SET estoque_devolvido_em=NOW() WHERE id=$1 AND empresa_id=$2", [order.id, order.empresa_id]);
            }
            if (!order.entregue_em && !["ENTREGUE", "FINALIZADA"].includes(order.status)) {
                await client.query("UPDATE vendas SET status='CANCELADA',cancelado_em=NOW(),cancelado_por=$1,cancelamento_motivo=$2 WHERE id=$3 AND empresa_id=$4", [refund.solicitado_por, refund.motivo, order.id, order.empresa_id]);
                await queueCustomerEmail(client, order, "CANCELADA");
            } else {
                await flagReview(client, order, "Cancelamento reembolsado após entrega: confirme a devolução física antes de ajustar o pedido.");
            }
            await audit.record(client, actor, "REEMBOLSAR", "vendas", order.id, { status: order.status }, { status: "CANCELADA", valor: Number(refund.valor_centavos) });
        }
    }
    return evidence;
}
const providerIdPattern = /^CBKS_[A-Za-z0-9-]{1,100}$/;
function validateChargeback(order, data, id) {
    if (!providerIdPattern.test(id) || data?.id !== id || data.transaction?.reference_id !== order.id || moneyToCents(order.valor_final) !== cents(data.transaction?.amount) || data.amount?.currency !== "BRL")
        fail("Chargeback divergente do pedido.", 502);
    const amount = cents(data.amount?.value);
    const updated = new Date(data.updated_at);
    if (!amount || amount > moneyToCents(order.valor_final) || Number.isNaN(updated.getTime()) || !["AWAITING_EVIDENCE", "REVIEW_WITH_PAGBANK", "SUBMITTED_ISSUER", "APPROVED", "DENIED", "EXPIRED", "CLOSED", "WON", "LOST"].includes(data.status))
        fail("Chargeback sem valores, estado ou data válidos.", 502);
    return { id, status: data.status, valor_centavos: amount, referencia: order.id, atualizado_em: updated.toISOString() };
}
async function applyChargeback(client, order, data, id, actor = actorFor(order)) {
    const evidence = validateChargeback(order, data, id);
    const previous = (await client.query("SELECT * FROM disputas_pagamento WHERE provedor_id=$1 FOR UPDATE", [id])).rows[0];
    if (previous && (previous.venda_id !== order.id || previous.empresa_id !== order.empresa_id || Number(previous.valor_centavos) !== evidence.valor_centavos)) fail("Chargeback já vinculado a outro pedido ou valor.", 409);
    if (previous && new Date(previous.atualizado_provedor_em).getTime() > new Date(evidence.atualizado_em).getTime()) return { ...evidence, ignorado: true };
    if (previous && new Date(previous.atualizado_provedor_em).getTime() === new Date(evidence.atualizado_em).getTime() && previous.status_provedor !== evidence.status)
        fail("Chargeback com estados conflitantes na mesma data.", 502);
    // Falha de defesa não prova débito final. Só LOST/CLOSED confirma perda;
    // WON compensa uma perda anteriormente confirmada. Revisões intermediárias preservam saldo.
    const oldLoss = Number(previous?.perda_centavos || 0);
    const loss = ["LOST", "CLOSED"].includes(evidence.status) ? evidence.valor_centavos : evidence.status === "WON" ? 0 : oldLoss;
    const delta = loss - oldLoss;
    const event = await addEvent(client, order, delta > 0 ? "CHARGEBACK" : delta < 0 ? "REVERSAO_CHARGEBACK" : "CONSULTA", id, Math.abs(delta), evidence);
    await addLedger(client, order, event, delta > 0 ? "CHARGEBACK" : "REVERSAO_CHARGEBACK", delta > 0 ? "PAGAR" : "RECEBER", Math.abs(delta));
    await client.query(`INSERT INTO disputas_pagamento(empresa_id,venda_id,provedor_id,status_provedor,valor_centavos,perda_centavos,atualizado_provedor_em)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provedor_id) DO UPDATE SET status_provedor=EXCLUDED.status_provedor,
        perda_centavos=EXCLUDED.perda_centavos,atualizado_provedor_em=EXCLUDED.atualizado_provedor_em,atualizado_em=NOW()`,
        [order.empresa_id, order.id, id, evidence.status, evidence.valor_centavos, loss, evidence.atualizado_em]);
    if (event) {
        await flagReview(client, order, "Chargeback " + id + ": " + evidence.status + ". Revise o atendimento e os lançamentos.");
        await audit.record(client, actor, "CONCILIAR_CHARGEBACK", "vendas", order.id, { status: previous?.status_provedor, valor: oldLoss }, { status: evidence.status, valor: loss });
    }
    return evidence;
}
async function lockOrder(client, id, company) {
    const { rows } = await client.query("SELECT * FROM vendas WHERE id=$1 AND empresa_id=$2 FOR UPDATE", [id, company]);
    if (!rows[0]) fail("Pedido não encontrado.", 404);
    return rows[0];
}
async function reconcile(db, req, id, gateway) {
    return db.transaction(async client => {
        const order = await lockOrder(client, id, req.user.empresaId);
        if (!order.pagseguro_charge_id) fail("Pedido sem cobrança PagBank vinculada.", 409);
        const result = await applyCharge(client, order, await gateway.consultarCobranca(order.pagseguro_charge_id), req);
        const disputeId = req.body?.chargeback_id;
        if (disputeId) {
            if (!providerIdPattern.test(disputeId)) fail("Identificador de chargeback inválido.");
            result.chargeback = await applyChargeback(client, order, await gateway.consultarChargeback(disputeId), disputeId, req);
        }
        return result;
    });
}
async function receivePaymentEvent(db, event, gateway) {
    return db.transaction(async client => {
        const { rows } = await client.query(`SELECT * FROM vendas WHERE id::text=$1 OR pagseguro_checkout_id=$1 OR pagseguro_order_id=$1 OR pagseguro_charge_id=$1 FOR UPDATE`, [event.referenceId]);
        const order = rows[0];
        if (rows.length > 1) fail("Referência de pagamento ambígua.", 409);
        if (!order || !order.estoque_baixado_em || !order.pagseguro_charge_id) return null;
        if (event.chargeId && event.chargeId !== order.pagseguro_charge_id) fail("Evento de outra cobrança.", 409);
        return applyCharge(client, order, await gateway.consultarCobranca(order.pagseguro_charge_id));
    });
}
async function receiveChargebackEvent(db, id, gateway) {
    if (!providerIdPattern.test(id)) fail("Identificador de chargeback inválido.");
    const data = await gateway.consultarChargeback(id);
    return db.transaction(async client => {
        const { rows } = await client.query("SELECT * FROM vendas WHERE id::text=$1 FOR UPDATE", [String(data.transaction?.reference_id || "")]);
        if (!rows[0]) return null;
        return applyChargeback(client, rows[0], data, id);
    });
}
async function review(db, req, id) {
    const { status, resposta } = req.body || {};
    if (!["EM_ANALISE", "CONCILIADO"].includes(status) || typeof resposta !== "string" || resposta.trim().length < 5 || resposta.length > 2000) fail("Informe análise e resposta entre 5 e 2000 caracteres.");
    return db.transaction(async client => {
        const order = await lockOrder(client, id, req.user.empresaId);
        if (status === "CONCILIADO") {
            const open = await client.query("SELECT id FROM disputas_pagamento WHERE empresa_id=$1 AND venda_id=$2 AND status_provedor NOT IN ('LOST','CLOSED','WON') UNION ALL SELECT id FROM reembolsos WHERE empresa_id=$1 AND venda_id=$2 AND status<>'CONCLUIDO'", [order.empresa_id, order.id]);
            if (open.rows.length) fail("Há disputa ou reembolso pendente. Concilie no provedor antes de concluir.", 409);
        }
        const { rows } = await client.query("UPDATE vendas SET conciliacao_status=$1,conciliacao_resposta=$2,conciliada_por=$3,conciliada_em=NOW() WHERE id=$4 AND empresa_id=$5 RETURNING id,conciliacao_status,conciliacao_resposta", [status, resposta.trim(), req.user.id, id, req.user.empresaId]);
        await audit.record(client, req, "REVISAR_CONCILIACAO", "vendas", id, { status: order.conciliacao_status }, { status, resposta: resposta.trim() });
        return rows[0];
    });
}
module.exports = { cents, moneyToCents, validateCharge, validateChargeback, applyCharge, applyChargeback, flagReview, queueCustomerEmail, lockOrder, reconcile, receivePaymentEvent, receiveChargebackEvent, review };
