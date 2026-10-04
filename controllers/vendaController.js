"use strict";

/* ==================================================
   DEPENDÊNCIAS
================================================== */

const VendaModel = require("../models/vendaModel");
const VendaService = require("../services/vendaService");

/* ==================================================
   CONSTANTES
================================================== */

const STATUS_PERMITIDOS = Object.freeze([
    "PENDENTE",
    "AGUARDANDO_PAGAMENTO",
    "PAGAMENTO_APROVADO",
    "EM_SEPARACAO",
    "SAIU_PARA_ENTREGA",
    "ENTREGUE",
    "FINALIZADA",
    "CANCELADA"
]);

/* ==================================================
   FUNÇÕES AUXILIARES
================================================== */

function obterEmpresaId(req) {

    return req.usuario?.empresaId ??
        req.user?.empresaId ??
        null;

}

function validarEmpresa(req, res) {

    const empresaId = obterEmpresaId(req);

    if (!empresaId) {

        res.status(403).json({
            erro: "Empresa do usuário não identificada."
        });

        return null;

    }

    return empresaId;

}

/* ==================================================
   CONTROLLER
================================================== */

class VendaController {

    /* ==========================
       LISTAR PEDIDOS
    ========================== */

    static async listar(req, res, next) {

        try {

            const empresaId = validarEmpresa(req, res);

            if (!empresaId) {
                return;
            }

            const pedidos = await VendaModel.listar(empresaId);

            return res.status(200).json(pedidos);

        } catch (error) {

            return next(error);

        }

    }

    /* ==========================
       BUSCAR PEDIDO POR ID
    ========================== */

    static async buscarPorId(req, res, next) {

        try {

            const { id } = req.params;
            const empresaId = validarEmpresa(req, res);

            if (!empresaId) {
                return;
            }

            const pedido = await VendaModel.buscarPorId(
                id,
                empresaId
            );

            if (!pedido) {

                return res.status(404).json({
                    erro: "Pedido não encontrado."
                });

            }

            return res.status(200).json(pedido);

        } catch (error) {

            return next(error);

        }

    }

    /* ==========================
       ATUALIZAR STATUS
    ========================== */

    static async atualizarStatus(req, res, next) {

        try {

            const { id } = req.params;
            const empresaId = validarEmpresa(req, res);

            if (!empresaId) {
                return;
            }

            const status = typeof req.body?.status === "string"
                ? req.body.status.trim().toUpperCase()
                : "";

            if (!status) {

                return res.status(400).json({
                    erro: "Informe o status do pedido."
                });

            }

            if (!STATUS_PERMITIDOS.includes(status)) {

                return res.status(400).json({
                    erro: "Status do pedido inválido.",
                    statusPermitidos: STATUS_PERMITIDOS
                });

            }

            const pedido = await VendaService.atualizarStatusPedido(
                empresaId,
                id,
                status,
                req
            );

            if (!pedido) {

                return res.status(404).json({
                    erro: "Pedido não encontrado."
                });

            }

            return res.status(200).json({
                mensagem: "Status do pedido atualizado com sucesso.",
                pedido
            });

        } catch (error) {

            return next(error);

        }

    }

    /* ==========================
       ESTATÍSTICAS DOS PEDIDOS
    ========================== */

    static async totalVendas(req, res, next) {

        try {

            const empresaId = validarEmpresa(req, res);

            if (!empresaId) {
                return;
            }

            const total = await VendaModel.totalVendas(empresaId);

            return res.status(200).json(total);

        } catch (error) {

            return next(error);

        }

    }

}

module.exports = VendaController;
