"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto");
module.exports = async function checkoutRecoveryScenarios({ db, company, other }) {
    const service = require("../services/checkoutService"), marker = crypto.randomBytes(5).toString("hex");
    const customer = (await db.query("INSERT INTO clientes(empresa_id,nome,email,telefone,whatsapp) VALUES($1,'Checkout Recuperação',$2,'11933334444','11933334444') RETURNING id", [company, marker + "@example.test"])).rows[0];
    const order = (await db.query("INSERT INTO vendas(empresa_id,cliente_id,forma_pagamento,status,reserva_expira_em) VALUES($1,$2,'PAGBANK','AGUARDANDO_PAGAMENTO',NOW()+INTERVAL '10 minutes') RETURNING id", [company, customer.id])).rows[0];
    let calls = 0, rejected = true;
    const gateway = { async criarCheckout(record) {
        assert.equal(record.id, order.id); calls++;
        if (rejected) throw Object.assign(new Error("CPF recusado pelo provedor simulado."), { paymentError: true, checkoutRejected: true, paymentErrorCode: "invalid_value", status: 400 });
        return { checkoutId: "CHEC_" + marker, checkoutUrl: "https://pagamento.pagbank.com.br/pagamento?code=" + marker, status: "ACTIVE", orderId: null, raw: { reference_id: order.id } };
    } };
    const principal = { id: customer.id, empresaId: company };
    await assert.rejects(service.create(db, principal, order.id, gateway), { status: 400 });
    assert.equal((await db.query("SELECT status FROM checkout_tentativas WHERE venda_id=$1", [order.id])).rows[0].status, "REJEITADA");
    rejected = false;
    const recovered = await service.create(db, principal, order.id, gateway);
    assert.equal(recovered.order.pagseguro_checkout_id, "CHEC_" + marker); assert.equal(calls, 2);
    assert.equal((await service.create(db, principal, order.id, gateway)).reused, true); assert.equal(calls, 2);
    await assert.rejects(service.create(db, { ...principal, empresaId: other }, order.id, gateway), { status: 404 });
    assert.equal(calls, 2);
    assert.equal((await db.query("SELECT COUNT(*)::integer AS total FROM vendas WHERE cliente_id=$1", [customer.id])).rows[0].total, 1);
};
