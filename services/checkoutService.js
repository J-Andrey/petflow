"use strict";
const model = require("../models/vendaModel");
const { UUID } = require("./sessionService");
const fail = (message, status = 409) => {
  throw Object.assign(new Error(message), { status });
};
function paymentData(checkout) {
  if (
    !checkout.checkoutId ||
    !checkout.checkoutUrl ||
    !/^https:\/\//i.test(checkout.checkoutUrl)
  )
    fail(
      "PagBank não retornou uma URL válida. A tentativa precisa ser conferida antes de repetir.",
      502,
    );
  return {
    pagseguroCheckoutId: checkout.checkoutId,
    pagseguroOrderId: checkout.orderId,
    pagseguroChargeId: checkout.chargeId,
    pagseguroStatus: checkout.status,
    pagseguroCheckoutUrl: checkout.checkoutUrl,
    pagseguroQrCode: checkout.qrCode,
    pagseguroQrCodeText: checkout.qrCodeText,
    pagseguroResponse: checkout.raw,
    formaPagamento: checkout.paymentMethod,
  };
}
async function create(db, customer, id, gateway) {
  if (!UUID.test(id)) fail("Pedido inválido.", 400);
  const prepared = await db.transaction(async (client) => {
    const order = (
      await client.query(
        "SELECT * FROM vendas WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3 FOR UPDATE",
        [id, customer.empresaId, customer.id],
      )
    ).rows[0];
    if (!order) fail("Pedido não encontrado.", 404);
    if (
      order.status !== "AGUARDANDO_PAGAMENTO" ||
      !order.reserva_expira_em ||
      new Date(order.reserva_expira_em) <= new Date()
    )
      fail("O pedido não possui uma reserva válida para pagamento.");
    if (order.pagseguro_checkout_url) return { order, reused: true };
    const attempt = await client.query(
      "INSERT INTO checkout_tentativas(venda_id,empresa_id,chave_idempotencia) VALUES($1,$2,$3) ON CONFLICT(venda_id) DO NOTHING RETURNING *",
      [id, customer.empresaId, "petflow-checkout-" + id],
    );
    if (!attempt.rowCount)
      fail(
        "O pagamento já foi solicitado e está em conferência. Consulte seus pedidos ou o atendimento; não repita a compra.",
      );
    return { key: attempt.rows[0].chave_idempotencia };
  });
  if (prepared.reused) return prepared;
  try {
    const order = await model.buscarPorIdDoCliente(
      id,
      customer.id,
      customer.empresaId,
    );
    const checkout = await gateway.criarCheckout(order, prepared.key);
    const data = paymentData(checkout);
    const saved = await db.transaction(async (client) => {
      const current = (
        await client.query(
          "SELECT * FROM vendas WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
          [id, customer.empresaId],
        )
      ).rows[0];
      if (current.estoque_baixado_em)
        data.pagseguroStatus = current.pagseguro_status;
      const result = await model.registrarPagamentoPagSeguro(
        id,
        customer.empresaId,
        data,
        client,
      );
      await client.query(
        "UPDATE checkout_tentativas SET status='CONCLUIDA',atualizada_em=NOW() WHERE venda_id=$1 AND empresa_id=$2",
        [id, customer.empresaId],
      );
      return {
        order: result,
        unavailable:
          current.status !== "AGUARDANDO_PAGAMENTO" ||
          new Date(current.reserva_expira_em) <= new Date(),
      };
    });
    if (saved.unavailable)
      fail(
        "A reserva terminou enquanto o pagamento era preparado. Consulte o atendimento.",
      );
    return saved;
  } catch (error) {
    await db.query(
      "UPDATE checkout_tentativas SET status='INCERTA',atualizada_em=NOW() WHERE venda_id=$1 AND empresa_id=$2 AND status<>'CONCLUIDA'",
      [id, customer.empresaId],
    );
    throw error;
  }
}
async function reconcile(db, req, id, checkoutId, gateway) {
  if (!UUID.test(id) || !/^[A-Za-z0-9_-]{6,150}$/.test(checkoutId || ""))
    fail("Identificadores inválidos.", 400);
  const order = await model.buscarPorId(id, req.user.empresaId);
  if (!order) fail("Pedido não encontrado.", 404);
  const checkout = await gateway.consultarCheckout(checkoutId);
  if (checkout.raw?.reference_id !== id)
    fail("O checkout informado não pertence a este pedido.");
  const data = paymentData(checkout);
  return db.transaction(async (client) => {
    const current = (
      await client.query(
        "SELECT * FROM vendas WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
        [id, req.user.empresaId],
      )
    ).rows[0];
    if (current.estoque_baixado_em)
      data.pagseguroStatus = current.pagseguro_status;
    if (
      current.pagseguro_checkout_id &&
      current.pagseguro_checkout_id !== checkoutId
    )
      fail("O pedido já está vinculado a outro checkout.");
    const saved = await model.registrarPagamentoPagSeguro(
      id,
      req.user.empresaId,
      data,
      client,
    );
    await client.query(
      "UPDATE checkout_tentativas SET status='CONCLUIDA',atualizada_em=NOW() WHERE venda_id=$1 AND empresa_id=$2",
      [id, req.user.empresaId],
    );
    await require("./auditService").record(
      client,
      req,
      "CONCILIAR_CHECKOUT",
      "vendas",
      id,
      null,
      { status: saved.status },
    );
    return { id: saved.id, status: saved.status };
  });
}
module.exports = { create, reconcile };
