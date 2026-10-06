"use strict";

/* ==================================================
   DEPENDÊNCIAS
================================================== */

const FinanceiroModel = require("../models/financeiroModel");

/* ==================================================
   SERVICE
================================================== */

class FinanceiroService {

    /* ==========================
       GERAR CONTA A RECEBER
    ========================== */

    static async gerarContaReceber(

        empresaId,

        venda,

        client

    ) {

        return FinanceiroModel.criar({

            empresa_id: empresaId,

            tipo: "RECEBER",

            origem: "VENDA",

            referencia_id: venda.id,

            descricao: `Venda #${venda.id}`,

            valor: venda.valor_final,

            valor_pago: 0,

            data_vencimento: venda.data_venda || new Date(),

            status: "PENDENTE",

            observacoes: venda.observacoes || null

        }, client);

    }

    /* ==========================
       GERAR CONTA A PAGAR
    ========================== */

    static async gerarContaPagar(

        empresaId,

        compra,

        client

    ) {

        return FinanceiroModel.criar({

            empresa_id: empresaId,

            tipo: "PAGAR",

            origem: "COMPRA",

            referencia_id: compra.id,

            descricao: `Compra #${compra.id}`,

            valor: compra.valor_total,

            valor_pago: 0,

            data_vencimento: compra.data_compra || new Date(),

            status: "PENDENTE",

            observacoes: compra.observacoes || null

        }, client);

    }

    /* ==========================
       MARCAR COMO PAGO
    ========================== */

    static async pagar(

        id,

        empresaId,

        client

    ) {

        const lancamento = await FinanceiroModel.buscarPorId(

            id,

            empresaId

        );

        if (!lancamento) {

            throw new Error("Lançamento financeiro não encontrado.");

        }

        return FinanceiroModel.atualizar(

            id,

            empresaId,

            {

                ...lancamento,

                valor_pago: lancamento.valor,

                data_pagamento: new Date(),

                status: "PAGO"

            },

            client

        );

    }

    /* ==========================
       CANCELAR
    ========================== */

    static async cancelar(

        id,

        empresaId,

        client

    ) {

        const lancamento = await FinanceiroModel.buscarPorId(

            id,

            empresaId

        );

        if (!lancamento) {

            throw new Error("Lançamento financeiro não encontrado.");

        }

        return FinanceiroModel.atualizar(

            id,

            empresaId,

            {

                ...lancamento,

                status: "CANCELADO"

            },

            client

        );

    }

}

module.exports = FinanceiroService;
