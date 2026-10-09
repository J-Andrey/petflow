"use strict";

const reconciliation = require("./paymentReconciliationService");
const fail = message => { throw Object.assign(new Error(message), { status: 502, paymentError: true, paymentErrorCode: "payment_evidence_mismatch" }); };
const methods = { PIX: "PIX", CREDIT_CARD: "CARTAO_CREDITO", DEBIT_CARD: "CARTAO_DEBITO" };

function chargesFromCheckout(raw) {
    const charges = [];
    if (Array.isArray(raw?.charges)) charges.push(...raw.charges.map(charge => ({ charge, orderId: raw.order_id || null })));
    for (const order of [...(Array.isArray(raw?.orders) ? raw.orders : []), ...(Array.isArray(raw?.payments) ? raw.payments : [])]) {
        if (Array.isArray(order.charges)) charges.push(...order.charges.map(charge => ({ charge, orderId: order.id })));
    }
    return charges;
}

// Um webhook autenticado avisa que houve mudança. A consulta ao provedor
// comprova o vínculo e os valores antes de liberar estoque ou financeiro.
async function resolve(order, gateway, event = {}) {
    let checkout, canonicalOrder, linkedCharges;
    if (order.pagseguro_checkout_id) {
        checkout = await gateway.consultarCheckout(order.pagseguro_checkout_id);
        if (checkout.checkoutId !== order.pagseguro_checkout_id || checkout.raw?.reference_id !== order.id)
            fail("O checkout consultado diverge do pedido. Procure o atendimento.");
        linkedCharges = chargesFromCheckout(checkout.raw);
    } else if (event.orderId) {
        canonicalOrder = await gateway.consultarPedido(event.orderId);
        if (canonicalOrder?.id !== event.orderId || canonicalOrder?.reference_id !== order.id)
            fail("O pagamento consultado diverge do pedido. Procure o atendimento.");
        linkedCharges = (Array.isArray(canonicalOrder.charges) ? canonicalOrder.charges : []).map(charge => ({ charge, orderId: canonicalOrder.id }));
    } else {
        fail("Não foi possível vincular o pagamento ao pedido. A administração precisa conferir o checkout.");
    }

    // Depois da primeira aprovação, um evento de outra tentativa de cartão
    // não pode trocar a cobrança que já originou a baixa do pedido.
    const selected = order.estoque_baixado_em && order.pagseguro_charge_id
        ? linkedCharges.find(item => item.charge.id === order.pagseguro_charge_id)
        : linkedCharges.find(item => item.charge.id === checkout?.chargeId) || linkedCharges.slice().sort((a, b) =>
            (b.charge.status === "PAID") - (a.charge.status === "PAID") ||
            (new Date(b.charge.created_at).getTime() || 0) - (new Date(a.charge.created_at).getTime() || 0))[0];
    if (order.estoque_baixado_em && order.pagseguro_charge_id && !selected)
        fail("A cobrança confirmada não consta no pagamento consultado. Procure o atendimento.");
    if (checkout?.chargeId && !linkedCharges.some(item => item.charge.id === checkout.chargeId))
        fail("A cobrança não pertence ao checkout consultado. Procure o atendimento.");

    let charge = selected?.charge;
    if (!charge?.id && (checkout?.status === "PAID" || canonicalOrder?.status === "PAID"))
        fail("O pagamento aprovado está sem cobrança identificada.");
    if (charge?.status === "PAID" || order.estoque_baixado_em) {
        if (!charge?.id) fail("O pagamento aprovado está sem cobrança identificada.");
        charge = await gateway.consultarCobranca(charge.id);
        let evidence;
        try { evidence = reconciliation.validateCharge({ ...order, pagseguro_charge_id: selected.charge.id }, charge); }
        catch { fail("O resumo do pagamento diverge do pedido. Procure o atendimento antes de tentar outra compra."); }
        if (charge.status === "PAID" && evidence.pago_centavos !== evidence.total_centavos)
            fail("O total pago diverge do pedido. Procure o atendimento.");
    }
    const providerStatus = charge?.status || checkout?.status || canonicalOrder?.status || null;
    // A recusa ou o cancelamento de uma tentativa não encerra o checkout ativo.
    const status = providerStatus === "PAID" ? "PAGAMENTO_APROVADO"
        : checkout && ["EXPIRED", "INACTIVE", "CANCELED", "CANCELLED"].includes(checkout.raw?.status) ? "CANCELADA"
        : "AGUARDANDO_PAGAMENTO";
    return {
        status,
        chargeId: charge?.id || null,
        data: {
            pagseguroStatus: providerStatus,
            pagseguroOrderId: selected?.orderId || checkout?.orderId || order.pagseguro_order_id || null,
            pagseguroChargeId: charge?.id || null,
            pagseguroResponse: checkout?.raw || canonicalOrder,
            formaPagamento: methods[charge?.payment_method?.type] || checkout?.paymentMethod || null,
        },
    };
}

module.exports = { resolve };
