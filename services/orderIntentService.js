"use strict";
const crypto = require("node:crypto");
const { UUID } = require("./sessionService");
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function prepare(venda, items, address, paymentMethod) {
    if (venda.chave_pedido == null) return null; // Chamadores internos legados não expõem POST público.
    if (typeof venda.chave_pedido !== "string" || !UUID.test(venda.chave_pedido))
        fail("Atualize a página da sacola antes de finalizar o pedido.");
    const coupon = String(venda.cupom_codigo || "").trim().toUpperCase();
    const observations = String(venda.observacoes || "").trim();
    if (coupon && !/^[A-Z0-9_-]{3,40}$/.test(coupon)) fail("Cupom inválido.");
    if (observations.length > 2000) fail("Observações do pedido excedem o limite permitido.");
    // Cotação, preços e data não definem uma nova intenção. Assim um reenvio
    // recupera o pedido já gravado mesmo depois de expirar o token de frete.
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
        itens: items, endereco: address, cupom: coupon || null,
        observacoes: observations, forma_pagamento: paymentMethod,
    })).digest("hex");
    return { key: venda.chave_pedido.toLowerCase(), fingerprint };
}
async function recover(client, empresaId, customerId, intent) {
    if (!intent) return null;
    const previous = (await client.query("SELECT fingerprint,venda_id FROM pedido_intencoes WHERE empresa_id=$1 AND cliente_id=$2 AND chave=$3", [empresaId, customerId, intent.key])).rows[0];
    if (!previous) return null;
    if (previous.fingerprint !== intent.fingerprint)
        fail("Esta tentativa já pertence a um pedido com outros dados. Retome o pedido anterior ou confira Meus pedidos.", 409);
    const order = (await client.query("SELECT * FROM vendas WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3", [previous.venda_id, empresaId, customerId])).rows[0];
    if (!order) fail("O pedido anterior não está disponível. Consulte o atendimento.", 409);
    const items = (await client.query("SELECT * FROM itens_venda WHERE venda_id=$1 AND empresa_id=$2 ORDER BY produto_id,id", [order.id, empresaId])).rows;
    return { success: true, reused: true, message: "Pedido anterior recuperado.", venda: order, itens: items };
}
async function save(client, empresaId, customerId, intent, orderId) {
    if (!intent) return;
    await client.query("INSERT INTO pedido_intencoes(empresa_id,cliente_id,chave,fingerprint,venda_id) VALUES($1,$2,$3,$4,$5)", [empresaId, customerId, intent.key, intent.fingerprint, orderId]);
}
module.exports = { prepare, recover, save };
