"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), service = require("../services/paymentReconciliationService");
const { load } = require("./helpers");
const order = () => ({ id: "10000000-0000-0000-0000-000000000001", empresa_id: "company", cliente_id: "customer", status: "ENTREGUE", entregue_em: new Date(), valor_final: "10.00", pagseguro_charge_id: "CHAR_test", estornado_centavos: 0 });
const charge = refunded => ({ id: "CHAR_test", reference_id: order().id, status: refunded === 1000 ? "CANCELED" : "PAID", amount: { value: 1000, currency: "BRL", summary: { total: 1000, paid: 1000, refunded } } });
function fake() {
    const events = new Map(), ledger = [], queries = [], disputes = new Map();
    const client = { async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes("INSERT INTO conciliacao_eventos")) {
            if (events.has(params[4])) return { rows: [] };
            const event = { id: "event-" + events.size, evidencia: params[6] }; events.set(params[4], event); return { rows: [event] };
        }
        if (sql.includes("INSERT INTO financeiro")) { ledger.push({ type: params[1], origin: params[2], value: params[5] }); return { rows: [{ id: "ledger-" + ledger.length }] }; }
        if (sql.includes("SELECT * FROM disputas_pagamento")) return { rows: disputes.has(params[0]) ? [disputes.get(params[0])] : [] };
        if (sql.includes("INSERT INTO disputas_pagamento")) disputes.set(params[2], { empresa_id: params[0], venda_id: params[1], provedor_id: params[2], status_provedor: params[3], valor_centavos: params[4], perda_centavos: params[5], atualizado_provedor_em: params[6] });
        return { rows: [] };
    } };
    return { client, ledger, queries, events, disputes };
}
test("centavos rejeitam coerções, casas extras e resumo inválido", () => {
    assert.equal(service.moneyToCents("0.29"), 29);
    assert.equal(service.moneyToCents("99999999.99"), 9999999999);
    for (const input of [true, null, "1.001", "-1", "1e2", NaN]) assert.throws(() => service.moneyToCents(input));
    for (const input of ["100", true, null, 1.5, -1]) assert.throws(() => service.cents(input));
    const valid = charge(250);
    for (const invalid of [{ ...valid, id: "CHAR_other" }, { ...valid, amount: { ...valid.amount, currency: "USD" } }, charge(1001)]) assert.throws(() => service.validateCharge(order(), invalid));
    assert.equal(service.validateCharge(order(), { ...valid, reference_id: "referencia-da-cobranca" }).charge_id, "CHAR_test");
});
test("estorno parcial repetido/fora de ordem contabiliza apenas deltas e conserva entrega/estoque", async () => {
    const f = fake(), sale = order();
    await service.applyCharge(f.client, sale, charge(250));
    await service.applyCharge(f.client, sale, charge(250));
    await service.applyCharge(f.client, sale, charge(1000));
    assert.equal((await service.applyCharge(f.client, sale, charge(500))).ignorado, true);
    assert.deepEqual(f.ledger, [{ type: "PAGAR", origin: "ESTORNO", value: 250 }, { type: "PAGAR", origin: "ESTORNO", value: 750 }]);
    assert.equal(sale.estornado_centavos, 1000); assert.equal(sale.status, "ENTREGUE");
    assert.equal(f.queries.some(q => /UPDATE estoque|UPDATE financeiro SET/.test(q.sql)), false);
    assert.ok([...f.events.values()].every(e => !JSON.stringify(e.evidencia).includes("customer")));
});
test("chargeback requer prova canônica e compensa perda uma vez depois de WON", async () => {
    const f = fake(), sale = order(), id = "CBKS_test";
    const dispute = (status, day) => ({ id, status, updated_at: "2026-10-" + day + "T12:00:00Z", amount: { value: 400, currency: "BRL" }, transaction: { reference_id: sale.id, amount: 1000 } });
    await service.applyChargeback(f.client, sale, dispute("AWAITING_EVIDENCE", "01"), id);
    assert.equal(f.ledger.length, 0);
    await service.applyChargeback(f.client, sale, dispute("LOST", "03"), id);
    await service.applyChargeback(f.client, sale, dispute("LOST", "03"), id);
    assert.equal((await service.applyChargeback(f.client, sale, dispute("AWAITING_EVIDENCE", "02"), id)).ignorado, true);
    await service.applyChargeback(f.client, sale, dispute("WON", "04"), id);
    await service.applyChargeback(f.client, sale, dispute("WON", "04"), id);
    assert.deepEqual(f.ledger, [{ type: "PAGAR", origin: "CHARGEBACK", value: 400 }, { type: "RECEBER", origin: "REVERSAO_CHARGEBACK", value: 400 }]);
    assert.equal(f.queries.some(q => /UPDATE estoque/.test(q.sql)), false);
    await assert.rejects(service.applyChargeback(f.client, sale, dispute("LOST", "04"), id), /conflitantes/);
    assert.throws(() => service.validateChargeback(sale, { ...dispute("WON", "05"), transaction: { reference_id: "other", amount: 1000 } }, id), /divergente/);
});
test("conciliação de outra empresa falha antes de acessar provedor", async () => {
    let providerCalls = 0;
    const db = { transaction: fn => fn({ async query() { return { rows: [] }; } }) };
    await assert.rejects(service.reconcile(db, { user: { empresaId: "other" }, body: {} }, order().id, { async consultarCobranca() { providerCalls++; } }), { status: 404 });
    assert.equal(providerCalls, 0);
});
test("devolução exige quantidades inteiras, produtos únicos e decisão explícita de reposição", () => {
    const returns = require("../services/returnService"), product = order().id;
    assert.deepEqual(returns.validateItems([{ produto_id: product, quantidade: 2 }]), [{ produto_id: product, quantidade: 2 }]);
    for (const items of [[], [{ produto_id: product, quantidade: 0 }], [{ produto_id: product, quantidade: "1" }], [{ produto_id: product, quantidade: 1 }, { produto_id: product, quantidade: 1 }]]) assert.throws(() => returns.validateItems(items));
    assert.throws(() => returns.validateItems([{ produto_id: product }], true));
    assert.throws(() => returns.validateItems([{ produto_id: product, repor_estoque: "true" }], true));
});
test("cancelamento em rota exige GPS preciso, recente e distância conservadora", () => {
    const cancellation = require("../services/cancellationService"), paid = { ...order(), status: "PAGAMENTO_APROVADO", entregue_em: null, estoque_baixado_em: new Date(), data_venda: new Date() };
    assert.equal(cancellation.automaticAllowed(paid), true);
    assert.equal(cancellation.automaticAllowed({ ...paid, status: "SAIU_PARA_ENTREGA" }), false);
    const tracking = { atualizado_em: new Date(), observado_em:new Date(), rota_solicitada_em: new Date(), precisao_m: 10, velocidade: 2, rota: { distanceMeters: 3000,origem_gps_observado_em:new Date().toISOString() } };
    assert.equal(cancellation.automaticAllowed({ ...paid, status: "SAIU_PARA_ENTREGA" }, tracking), true);
    assert.equal(cancellation.automaticAllowed({ ...paid, status: "SAIU_PARA_ENTREGA" }, { ...tracking, precisao_m: 200 }), false);
    assert.equal(cancellation.automaticAllowed({ ...paid, status: "SAIU_PARA_ENTREGA" }, { ...tracking, rota:{distanceMeters:3000} }), false);
    assert.equal(cancellation.automaticAllowed({ ...paid, status: "SAIU_PARA_ENTREGA" }, { ...tracking, observado_em:new Date(Date.now()-60000) }), false);
    assert.equal(cancellation.automaticAllowed({ ...paid, entregue_em: new Date() }), false);
    assert.equal(cancellation.automaticAllowed({ ...paid, data_venda: new Date(Date.now() + 1000) }), false);
});
test("webhook chargeback é consultado canonicamente e assinatura inválida não chama provedor", async () => {
    let reconciled = 0;
    const controller = load("controllers/publicPaymentController.js", {
        "../models/vendaModel": {}, "../services/vendaService": {}, "../database/connection": {},
        "../services/pagseguroService": { validarAssinaturaWebhook: () => true },
        "../services/paymentReconciliationService": { async receiveChargebackEvent(db, id) { assert.equal(id, "CBKS_test"); reconciled++; } },
    });
    const { response } = require("./helpers"), res = response();
    await controller.receberWebhook({ body: { id: "CBKS_test" }, get() { return "signature"; } }, res, error => { throw error; });
    assert.equal(reconciled, 1); assert.equal(res.statusCode, 200);
});
