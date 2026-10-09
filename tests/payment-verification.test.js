"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { load, response } = require("./helpers");
const reconciliation = load("services/paymentReconciliationService.js", { "./auditService": {} });
const verification = load("services/paymentVerificationService.js", { "./paymentReconciliationService": reconciliation });
const id = "10000000-0000-0000-0000-000000000001";
function fixture() {
    const order = { id, empresa_id: "company", cliente_id: "customer", valor_final: "6.00", status: "AGUARDANDO_PAGAMENTO", pagseguro_checkout_id: "CHEC_test" };
    const charge = { id: "CHAR_paid", status: "PAID", payment_method: { type: "CREDIT_CARD" }, amount: { value: 600, currency: "BRL", summary: { total: 600, paid: 600, refunded: 0 } } };
    const checkout = { checkoutId: "CHEC_test", checkoutUrl: "https://example.test/payment", chargeId: "CHAR_paid", orderId: "ORDE_paid", status: "PAID", raw: { id: "CHEC_test", reference_id: id, status: "ACTIVE", orders: [{ id: "ORDE_paid", charges: [charge] }] } };
    const calls = [];
    const gateway = {
        validarAssinaturaWebhook() { return true; },
        extrairEventoWebhook(body) { return { referenceId: body.reference_id, orderId: body.id, chargeId: body.charges?.[0]?.id, pagseguroStatus: body.charges?.[0]?.status, vendaStatus: "PAGAMENTO_APROVADO" }; },
        async consultarCheckout(checkoutId) { calls.push(["checkout", checkoutId]); return checkout; },
        async consultarCobranca(chargeId) { calls.push(["charge", chargeId]); return charge; },
        async consultarPedido(orderId) { calls.push(["order", orderId]); return { id: orderId, reference_id: id, charges: [charge] }; },
    };
    const effects = { approved: 0, updated: 0, reconciled: 0 };
    const service = {
        async confirmarPagamento(company, ref, data) { effects.approved++; calls.push(["approved", data.pagseguroChargeId]); return { ...order, status: "PAGAMENTO_APROVADO" }; },
        async atualizarStatusPagamento(company, ref, status) { effects.updated++; return { ...order, status }; },
    };
    const controller = load("controllers/publicPaymentController.js", {
        "../models/vendaModel": { async buscarPorIdDoCliente() { return order; } },
        "../services/vendaService": service,
        "../services/pagseguroService": gateway,
        "../services/paymentVerificationService": verification,
        "../services/paymentReconciliationService": { async receivePaymentEvent() { effects.reconciled++; } },
        "../database/connection": { async query() { return { rows: [order] }; } },
    });
    return { order, charge, checkout, gateway, effects, calls, controller };
}
async function consult(f) {
    const res = response(); let failure;
    await f.controller.consultarPagamento({ customer: { id: "customer", empresaId: "company" }, params: { id } }, res, error => { failure = error; });
    return { res, failure };
}
test("consulta rejeita total, moeda e valor pago divergentes antes de estoque ou financeiro", async () => {
    for (const mutate of [f => { f.charge.amount.value = 599; f.charge.amount.summary.total = 599; f.charge.amount.summary.paid = 599; }, f => { f.charge.amount.currency = "USD"; }, f => { f.charge.amount.summary.paid = 300; }]) {
        const f = fixture(); mutate(f);
        const { res, failure } = await consult(f);
        assert.equal(failure, undefined); assert.equal(res.statusCode, 502); assert.match(res.body.message, /diverge|divergente/); assert.equal(res.body.codigo, "payment_evidence_mismatch");
        assert.deepEqual(f.effects, { approved: 0, updated: 0, reconciled: 0 });
    }
});
test("consulta confirma referência e vínculo da cobrança antes de aprovar", async () => {
    for (const mutate of [f => { f.checkout.raw.reference_id = "other"; }, f => { f.checkout.chargeId = "CHAR_other"; }, f => { f.charge.id = "CHAR_other"; }]) {
        const f = fixture(); mutate(f);
        const { res, failure } = await consult(f);
        assert.equal(failure, undefined); assert.equal(res.statusCode, 502); assert.equal(f.effects.approved, 0); assert.equal(f.effects.reconciled, 0);
    }
});
test("webhook usa consulta canônica e aprova cobrança paga entre tentativas recusadas", async () => {
    const f = fixture();
    f.checkout.raw.orders.unshift({ id: "ORDE_declined", charges: [{ id: "CHAR_declined", status: "DECLINED", created_at: "2026-10-09T12:00:00Z" }] });
    const res = response(); let failure;
    await f.controller.receberWebhook({ rawBody: "signed-payload", get() { return "signature"; }, body: { id: "ORDE_declined", reference_id: id, charges: [{ id: "CHAR_declined", status: "DECLINED" }] } }, res, error => { failure = error; });
    assert.equal(failure, undefined); assert.equal(res.statusCode, 200);
    assert.equal(f.effects.approved, 1); assert.deepEqual(f.calls.slice(0, 3), [["checkout", "CHEC_test"], ["charge", "CHAR_paid"], ["approved", "CHAR_paid"]]);
});
test("cancelamento de tentativa com checkout ativo não cancela pedido", async () => {
    const f = fixture(); f.charge.status = "CANCELED"; f.checkout.status = "CANCELED";
    const result = await verification.resolve(f.order, f.gateway);
    assert.equal(result.status, "AGUARDANDO_PAGAMENTO"); assert.equal(result.data.pagseguroStatus, "CANCELED");
    assert.equal(f.calls.some(call => call[0] === "charge"), false);
});
test("evento antigo preserva a cobrança confirmada ao consultar checkout com novas tentativas", async () => {
    const f = fixture(); f.order.status = "ENTREGUE"; f.order.estoque_baixado_em = new Date(); f.order.pagseguro_charge_id = "CHAR_paid";
    f.checkout.chargeId = "CHAR_declined"; f.checkout.status = "DECLINED";
    f.checkout.raw.orders.unshift({ id: "ORDE_declined", charges: [{ id: "CHAR_declined", status: "DECLINED" }] });
    const result = await verification.resolve(f.order, f.gateway);
    assert.equal(result.chargeId, "CHAR_paid"); assert.equal(result.status, "PAGAMENTO_APROVADO");
});
test("webhook após resposta incerta comprova vínculo consultando pedido PagBank", async () => {
    const f = fixture(); f.order.pagseguro_checkout_id = null;
    const result = await verification.resolve(f.order, f.gateway, { orderId: "ORDE_paid" });
    assert.equal(result.status, "PAGAMENTO_APROVADO"); assert.equal(result.data.pagseguroOrderId, "ORDE_paid");
    assert.deepEqual(f.calls, [["order", "ORDE_paid"], ["charge", "CHAR_paid"]]);
    f.gateway.consultarPedido = async () => ({ id: "ORDE_paid", reference_id: "other", charges: [f.charge] });
    await assert.rejects(verification.resolve(f.order, f.gateway, { orderId: "ORDE_paid" }), /diverge/);
});
test("PAID sem cobrança identificada nunca confirma o pedido", async () => {
    const f = fixture(); f.checkout.chargeId = null; f.checkout.raw.orders = [];
    await assert.rejects(verification.resolve(f.order, f.gateway), /sem cobrança/);
});
function latePaymentFixture(order) {
    const calls = [], effects = { stock: 0, finance: 0, saved: null };
    const client = { async query(sql, params) { calls.push({ sql, params }); if (sql.includes("FROM vendas")) return { rows: [order] }; return { rows: [] }; }, release() {} };
    const service = load("services/vendaService.js", {
        "../database/connection": { async connect() { return client; } }, "../config/env": { JWT_SECRET: "test" },
        "./deliveryService": { createDeliveryService() { return {}; } }, "./couponService": {},
        "../models/vendaModel": { async atualizarPagamentoPorReferencia(ref, data) { effects.saved = data; return { ...order, ...data, status: data.status }; } }, "../models/itemVendaModel": {},
        "./movimentacaoEstoqueService": { async saida() { effects.stock++; } }, "./financeiroService": { async gerarContaReceber() { effects.finance++; } }, "./reservationService": {}, "./emailService": {},
    });
    return { service, calls, effects };
}
test("pagamento tardio salva evidência e sinaliza conciliação sem ressuscitar nem baixar estoque", async () => {
    const f = latePaymentFixture({ id, empresa_id: "company", status: "CANCELADA", estoque_baixado_em: null });
    const result = await f.service.confirmarPagamento("company", id, { pagseguroStatus: "PAID", pagseguroChargeId: "CHAR_paid", pagseguroOrderId: "ORDE_paid" });
    assert.equal(result.status, "CANCELADA"); assert.equal(f.effects.saved.pagseguroChargeId, "CHAR_paid");
    assert.equal(f.effects.stock, 0); assert.equal(f.effects.finance, 0);
    assert.ok(f.calls.some(call => call.sql.includes("conciliacao_status='PENDENTE'")));
});
test("concorrência não troca a cobrança de pedido já confirmado", async () => {
    const f = latePaymentFixture({ id, empresa_id: "company", status: "ENTREGUE", estoque_baixado_em: new Date(), pagseguro_charge_id: "CHAR_paid" });
    await assert.rejects(f.service.confirmarPagamento("company", id, { pagseguroStatus: "PAID", pagseguroChargeId: "CHAR_other" }), { status: 409 });
    assert.equal(f.effects.saved, null); assert.equal(f.effects.stock, 0);
});
function administrativeFixture() {
    const f = fixture();
    const client = { async query(sql) { return { rows: sql.includes("SELECT * FROM vendas") ? [f.order] : [] }; } };
    const db = { async transaction(fn) { return fn(client); } };
    let saved = 0;
    const service = load("services/checkoutService.js", {
        "../models/vendaModel": { async buscarPorId() { return f.order; }, async registrarPagamentoPagSeguro(id, company, data) { saved++; Object.assign(f.order, { pagseguro_checkout_id: data.pagseguroCheckoutId, pagseguro_charge_id: data.pagseguroChargeId }); return f.order; } },
        "./paymentVerificationService": verification,
        "./auditService": { async record() {} },
        "./paymentReconciliationService": { async receivePaymentEvent() {} },
        "./vendaService": {
            async confirmarPagamento(company, id, data) { f.effects.approved++; return { ...f.order, pagseguro_status: data.pagseguroStatus, status: ["CANCELADA", "ENTREGUE"].includes(f.order.status) ? f.order.status : "PAGAMENTO_APROVADO" }; },
            async atualizarStatusPagamento(company, id, status) { return { ...f.order, status }; },
        },
    });
    return { ...f, service, db, saved: () => saved };
}
test("recuperação administrativa confirma checkout PAID já verificado sem criar cobrança", async () => {
    const f = administrativeFixture();
    const result = await f.service.reconcile(f.db, { user: { empresaId: "company" } }, id, "CHEC_test", f.gateway);
    assert.equal(result.status, "PAGAMENTO_APROVADO"); assert.equal(f.saved(), 1); assert.equal(f.effects.approved, 1);
    assert.deepEqual(f.calls, [["checkout", "CHEC_test"], ["charge", "CHAR_paid"]]);
});
test("recuperação administrativa rejeita referência e total divergentes antes de persistir", async () => {
    for (const mutate of [f => { f.checkout.raw.reference_id = "other"; }, f => { f.charge.amount.currency = "USD"; }]) {
        const f = administrativeFixture(); mutate(f);
        await assert.rejects(f.service.reconcile(f.db, { user: { empresaId: "company" } }, id, "CHEC_test", f.gateway));
        assert.equal(f.saved(), 0); assert.equal(f.effects.approved, 0);
    }
});
test("recuperação administrativa conserva cancelamento e entrega ao confirmar PAID existente", async () => {
    for (const status of ["CANCELADA", "ENTREGUE"]) {
        const f = administrativeFixture(); f.order.status = status;
        if (status === "ENTREGUE") { f.order.estoque_baixado_em = new Date(); f.order.pagseguro_charge_id = "CHAR_paid"; }
        const result = await f.service.reconcile(f.db, { user: { empresaId: "company" } }, id, "CHEC_test", f.gateway);
        assert.equal(result.status, status); assert.equal(f.order.pagseguro_charge_id, "CHAR_paid");
    }
});
