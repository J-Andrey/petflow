"use strict";

const VendaModel = require("../models/vendaModel");
const VendaService = require("../services/vendaService");
const pagseguroService = require("../services/pagseguroService");
const db = require("../database/connection");
const reconciliation = require("../services/paymentReconciliationService");

async function criarPagamento(request, response, next) {
  try {
    const customer = getAuthenticatedCustomer(request);
    if (!customer)
      return response
        .status(401)
        .json({
          success: false,
          message: "Faça login para iniciar o pagamento.",
        });
    const id =
      request.body?.vendaId ||
      request.body?.venda_id ||
      request.body?.pedidoId ||
      request.body?.pedido_id;
    const result = await require("../services/checkoutService").create(
      db,
      customer,
      id,
      pagseguroService,
    );
    return response
      .status(result.reused ? 200 : 201)
      .json({
        success: true,
        message: result.reused
          ? "Pagamento já iniciado."
          : "Pagamento iniciado com sucesso.",
        payment: buildPaymentResponse(result.order),
      });
  } catch (error) {
    if (error.paymentError) return response.status(error.status || 502).json({ success: false, message: error.message, codigo: error.paymentErrorCode, pagamento: error.checkoutRejected ? "REJEITADO" : "EM_CONFERENCIA" });
    next(error);
  }
}

async function consultarPagamento(request, response, next) {
  try {
    const customer = getAuthenticatedCustomer(request);
    const { id } = request.params;

    if (!customer) {
      return response.status(401).json({
        success: false,
        message: "Faça login para consultar o pagamento.",
      });
    }

    const pedido = await VendaModel.buscarPorIdDoCliente(
      id,
      customer.id,
      customer.empresaId,
    );

    if (!pedido) {
      return response.status(404).json({
        success: false,
        message: "Pedido não encontrado.",
      });
    }

    if (!pedido.pagseguro_checkout_id) {
      return response.status(200).json({
        success: true,
        message: "Pagamento ainda não iniciado.",
        payment: buildPaymentResponse(pedido),
      });
    }

    const checkout = await pagseguroService.consultarCheckout(
      pedido.pagseguro_checkout_id,
    );

    const status = pagseguroService.mapStatusToVenda(checkout.status);

    const dadosPagamento = {
      pagseguroStatus: checkout.status,
      pagseguroOrderId: checkout.orderId,
      pagseguroChargeId: checkout.chargeId,
      pagseguroResponse: checkout.raw,
      formaPagamento: checkout.paymentMethod,
    };

    const vendaAtualizada =
      status === "PAGAMENTO_APROVADO"
        ? await VendaService.confirmarPagamento(
            customer.empresaId,
            pedido.pagseguro_checkout_id,
            dadosPagamento,
          )
        : await VendaService.atualizarStatusPagamento(
            customer.empresaId,
            pedido.pagseguro_checkout_id,
            status,
            dadosPagamento,
          );

    await reconciliation.receivePaymentEvent(db, {
      referenceId: pedido.id,
      chargeId: checkout.chargeId,
    }, pagseguroService);

    return response.status(200).json({
      success: true,
      message: "Pagamento consultado com sucesso.",
      payment: buildPaymentResponse(vendaAtualizada || pedido),
    });
  } catch (error) {
    if (error.paymentError) return response.status(error.status || 502).json({ success: false, message: error.message, codigo: error.paymentErrorCode });
    return next(error);
  }
}

async function receberWebhook(request, response, next) {
  try {
    const isValidSignature = pagseguroService.validarAssinaturaWebhook(
      request.rawBody,
      request.get("x-authenticity-token"),
    );

    if (!isValidSignature) {
      return response.status(401).json({
        success: false,
        message: "Assinatura do webhook inválida.",
      });
    }

    if (/^CBKS_/.test(request.body?.id || "")) {
      await reconciliation.receiveChargebackEvent(db, request.body.id, pagseguroService);
      return response.status(200).json({ success: true, message: "Chargeback consultado e conciliado." });
    }

    const event = pagseguroService.extrairEventoWebhook(request.body || {});

    if (!event.referenceId) {
      return response.status(200).json({
        success: true,
        message: "Webhook recebido sem referência de pedido.",
      });
    }

    const dadosPagamento = {
      pagseguroStatus: event.pagseguroStatus,
      pagseguroOrderId: event.orderId,
      pagseguroChargeId: event.chargeId,
      pagseguroResponse: event.raw,
      formaPagamento: event.paymentMethod,
    };

    if (event.vendaStatus === "PAGAMENTO_APROVADO") {
      await VendaService.confirmarPagamento(
        null,
        event.referenceId,
        dadosPagamento,
      );
    } else {
      await VendaService.atualizarStatusPagamento(
        null,
        event.referenceId,
        event.vendaStatus,
        dadosPagamento,
      );
    }

    // Um estorno parcial permanece PAID no PagBank. Consultar o resumo em
    // qualquer notificação captura esse caso e evita confiar em payload antigo.
    await reconciliation.receivePaymentEvent(db, event, pagseguroService);

    return response.status(200).json({
      success: true,
      message: "Webhook processado com sucesso.",
    });
  } catch (error) {
    return next(error);
  }
}

function buildPaymentResponse(venda) {
  return {
    vendaId: venda.id,
    status: venda.status,
    pagseguroStatus: venda.pagseguro_status,
    checkoutId: venda.pagseguro_checkout_id,
    orderId: venda.pagseguro_order_id,
    chargeId: venda.pagseguro_charge_id,
    checkoutUrl: venda.pagseguro_checkout_url,
    qrCode: venda.pagseguro_qr_code,
    qrCodeText: venda.pagseguro_qr_code_text,
    atualizadoEm: venda.pagamento_atualizado_em,
  };
}

function getAuthenticatedCustomer(request) {
  const id = request.customer?.id;
  const empresaId = request.customer?.empresaId;

  if (!id || !empresaId) {
    return null;
  }

  return {
    id,
    empresaId,
  };
}

module.exports = {
  criarPagamento,
  consultarPagamento,
  receberWebhook,
};
