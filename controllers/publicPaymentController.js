"use strict";

const VendaModel = require("../models/vendaModel");
const VendaService = require("../services/vendaService");
const pagseguroService = require("../services/pagseguroService");
const db = require("../database/connection");

async function criarPagamento(request, response, next) {
    let client;
    try {
        const customer = getAuthenticatedCustomer(request);
        const vendaId =
            request.body?.vendaId ||
            request.body?.venda_id ||
            request.body?.pedidoId ||
            request.body?.pedido_id;

        if (!customer) {
            return response.status(401).json({
                success: false,
                message: "Faça login para iniciar o pagamento."
            });
        }

        if (!vendaId) {
            return response.status(400).json({
                success: false,
                message: "Informe o pedido para pagamento."
            });
        }
        if(!require("../services/sessionService").UUID.test(vendaId)) {
            return response.status(400).json({success:false,message:"Pedido inválido."});
        }
        client=await db.connect();
        await client.query("BEGIN");
        const locked=await client.query("SELECT id FROM vendas WHERE id=$1 AND cliente_id=$2 AND empresa_id=$3 FOR UPDATE",[vendaId,customer.id,customer.empresaId]);
        if(!locked.rowCount) return response.status(404).json({success:false,message:"Pedido não encontrado."});

        const pedido = await VendaModel.buscarPorIdDoCliente(
            vendaId,
            customer.id,
            customer.empresaId
        );

        if (!pedido) {
            return response.status(404).json({
                success: false,
                message: "Pedido não encontrado."
            });
        }

        if (pedido.status !== "AGUARDANDO_PAGAMENTO") {
            return response.status(409).json({
                success: false,
                message: "Este pedido não está aguardando pagamento."
            });
        }
        if(pedido.reserva_expira_em && new Date(pedido.reserva_expira_em)<=new Date()) {
            return response.status(409).json({success:false,message:"Reserva expirada. Crie um novo pedido."});
        }

        if (pedido.pagseguro_checkout_url) {
            return response.status(200).json({
                success: true,
                message: "Pagamento já iniciado.",
                payment: buildPaymentResponse(pedido)
            });
        }

        const checkout = await pagseguroService.criarCheckout(pedido);
        if(!checkout.checkoutUrl || !checkout.checkoutId || !/^https:\/\//i.test(checkout.checkoutUrl)) {
            throw Object.assign(new Error("PagBank não retornou uma URL de pagamento válida."),{status:502});
        }

        const vendaAtualizada =
            await VendaModel.registrarPagamentoPagSeguro(
                pedido.id,
                customer.empresaId,
                {
                    pagseguroCheckoutId: checkout.checkoutId,
                    pagseguroOrderId: checkout.orderId,
                    pagseguroChargeId: checkout.chargeId,
                    pagseguroStatus: checkout.status,
                    pagseguroCheckoutUrl: checkout.checkoutUrl,
                    pagseguroQrCode: checkout.qrCode,
                    pagseguroQrCodeText: checkout.qrCodeText,
                    pagseguroResponse: checkout.raw,
                    formaPagamento: checkout.paymentMethod
                },
                client
            );
        await client.query("COMMIT");

        return response.status(201).json({
            success: true,
            message: "Pagamento iniciado com sucesso.",
            payment: buildPaymentResponse(vendaAtualizada)
        });
    } catch (error) {
        return next(error);
    } finally {
        if(client) { await client.query("ROLLBACK").catch(()=>{}); client.release(); }
    }
}

async function consultarPagamento(request, response, next) {
    try {
        const customer = getAuthenticatedCustomer(request);
        const { id } = request.params;

        if (!customer) {
            return response.status(401).json({
                success: false,
                message: "Faça login para consultar o pagamento."
            });
        }

        const pedido = await VendaModel.buscarPorIdDoCliente(
            id,
            customer.id,
            customer.empresaId
        );

        if (!pedido) {
            return response.status(404).json({
                success: false,
                message: "Pedido não encontrado."
            });
        }

        if (!pedido.pagseguro_checkout_id) {
            return response.status(200).json({
                success: true,
                message: "Pagamento ainda não iniciado.",
                payment: buildPaymentResponse(pedido)
            });
        }

        const checkout = await pagseguroService.consultarCheckout(
            pedido.pagseguro_checkout_id
        );

        const status = pagseguroService.mapStatusToVenda(
            checkout.status
        );

        const dadosPagamento = {
            pagseguroStatus: checkout.status,
            pagseguroOrderId: checkout.orderId,
            pagseguroChargeId: checkout.chargeId,
            pagseguroResponse: checkout.raw,
            formaPagamento: checkout.paymentMethod
        };

        const vendaAtualizada = status === "PAGAMENTO_APROVADO"
            ? await VendaService.confirmarPagamento(
                customer.empresaId,
                pedido.pagseguro_checkout_id,
                dadosPagamento
            )
            : await VendaService.atualizarStatusPagamento(
                customer.empresaId,
                pedido.pagseguro_checkout_id,
                status,
                dadosPagamento
            );

        return response.status(200).json({
            success: true,
            message: "Pagamento consultado com sucesso.",
            payment: buildPaymentResponse(vendaAtualizada || pedido)
        });
    } catch (error) {
        return next(error);
    }
}

async function receberWebhook(request, response, next) {
    try {
        const isValidSignature =
            pagseguroService.validarAssinaturaWebhook(
                request.rawBody,
                request.get("x-authenticity-token")
            );

        if (!isValidSignature) {
            return response.status(401).json({
                success: false,
                message: "Assinatura do webhook inválida."
            });
        }

        const event = pagseguroService.extrairEventoWebhook(
            request.body || {}
        );

        if (!event.referenceId) {
            return response.status(200).json({
                success: true,
                message: "Webhook recebido sem referência de pedido."
            });
        }

        const dadosPagamento = {
            pagseguroStatus: event.pagseguroStatus,
            pagseguroOrderId: event.orderId,
            pagseguroChargeId: event.chargeId,
            pagseguroResponse: event.raw,
            formaPagamento: event.paymentMethod
        };

        if (event.vendaStatus === "PAGAMENTO_APROVADO") {
            await VendaService.confirmarPagamento(
                null,
                event.referenceId,
                dadosPagamento
            );
        } else {
            await VendaService.atualizarStatusPagamento(
                null,
                event.referenceId,
                event.vendaStatus,
                dadosPagamento
            );
        }

        return response.status(200).json({
            success: true,
            message: "Webhook processado com sucesso."
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
        atualizadoEm: venda.pagamento_atualizado_em
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
        empresaId
    };
}

module.exports = {
    criarPagamento,
    consultarPagamento,
    receberWebhook
};
