"use strict";

const db = require("../database/connection");

const CompraModel = require("../models/compraModel");
const ItemCompraModel = require("../models/itemCompraModel");

const MovimentacaoEstoqueService = require("./movimentacaoEstoqueService");
const FinanceiroService = require("./financeiroService");

const CompraService = {
  /* ==============================================
       FINALIZAR COMPRA
    ============================================== */

  async finalizarCompra(empresaId, compra, itens, request) {
    if (!Array.isArray(itens) || itens.length === 0) {
      throw Object.assign(
        new Error("A compra deve possuir pelo menos um item."),
        { status: 400 },
      );
    }

    const { UUID } = require("./sessionService");
    const bad = (message) => {
      throw Object.assign(new Error(message), { status: 400 });
    };
    if (!UUID.test(compra.fornecedor_id)) bad("Fornecedor inválido.");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(compra.data_compra || "") ||
      Number.isNaN(Date.parse(compra.data_compra)) ||
      new Date(compra.data_compra).toISOString().slice(0, 10) !==
        compra.data_compra
    )
      bad("Data da compra inválida.");
    if (
      itens.length > 100 ||
      (compra.observacoes &&
        (typeof compra.observacoes !== "string" ||
          compra.observacoes.length > 2000))
    )
      bad("Compra acima dos limites permitidos.");
    const cents = require("./financialAdminService").cents;
    itens = itens
      .map((item) => {
        const quantidade = Number(item.quantidade);
        if (
          !UUID.test(item.produto_id) ||
          !Number.isSafeInteger(quantidade) ||
          quantidade <= 0 ||
          quantidade > 999999
        )
          bad("Produto ou quantidade inválidos.");
        const unit = cents(item.valor_unitario);
        if (unit <= 0) bad("O custo unitário deve ser positivo.");
        return {
          ...item,
          quantidade,
          valor_unitario: unit / 100,
          centavos: unit,
        };
      })
      .sort((a, b) => a.produto_id.localeCompare(b.produto_id));
    const totalCents = itens.reduce(
      (sum, item) => sum + item.quantidade * item.centavos,
      0,
    );
    if (!Number.isSafeInteger(totalCents) || totalCents > 9999999999)
      bad("Total da compra acima do limite permitido.");

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const supplier = await client.query(
        "SELECT id FROM fornecedores WHERE id=$1 AND empresa_id=$2 AND ativo=TRUE FOR SHARE",
        [compra.fornecedor_id, empresaId],
      );
      if (!supplier.rowCount) bad("Fornecedor indisponível para esta empresa.");
      const ids = [...new Set(itens.map((item) => item.produto_id))];
      const products = await client.query(
        "SELECT id FROM produtos WHERE id=ANY($1::uuid[]) AND empresa_id=$2 ORDER BY id FOR UPDATE",
        [ids, empresaId],
      );
      if (products.rowCount !== ids.length)
        bad("Há produto de outra empresa ou inexistente.");

      const novaCompra = await CompraModel.criar(
        {
          empresa_id: empresaId,
          fornecedor_id: compra.fornecedor_id,
          data_compra: compra.data_compra,
          valor_total: 0,
          observacoes: compra.observacoes,
        },
        client,
      );

      await client.query(
        "SELECT set_config('petflow.referencia_tipo','COMPRA',TRUE),set_config('petflow.referencia_id',$1,TRUE),set_config('petflow.usuario_id',$2,TRUE)",
        [novaCompra.id, request?.user?.id || ""],
      );

      let valorTotal = 0;

      const itensCriados = [];

      for (const item of itens) {
        const quantidade = Number(item.quantidade);
        const valorUnitario = Number(item.valor_unitario);

        if (quantidade <= 0) {
          throw new Error("Quantidade inválida.");
        }

        if (valorUnitario < 0) {
          throw new Error("Valor unitário inválido.");
        }

        const subtotal = (quantidade * item.centavos) / 100;

        const novoItem = await ItemCompraModel.criar(
          {
            compra_id: novaCompra.id,
            empresa_id: empresaId,
            produto_id: item.produto_id,
            quantidade,
            valor_unitario: valorUnitario,
            subtotal,
          },
          client,
        );

        itensCriados.push(novoItem);

        await MovimentacaoEstoqueService.entrada(
          empresaId,
          item.produto_id,
          quantidade,
          client,
        );

        valorTotal = totalCents / 100;
      }

      const compraAtualizada = await CompraModel.atualizarValorTotal(
        novaCompra.id,
        valorTotal,
        client,
      );

      /* ==========================================
               GERA CONTA A PAGAR
            ========================================== */

      await FinanceiroService.gerarContaPagar(
        empresaId,

        {
          id: compraAtualizada.id,

          valor_total: valorTotal,

          data_compra: compra.data_compra,

          observacoes: compra.observacoes,
        },

        client,
      );

      if (request)
        await require("./auditService").record(
          client,
          request,
          "CRIAR",
          "compras",
          novaCompra.id,
          null,
          { valor: valorTotal },
        );
      await client.query("COMMIT");

      return {
        success: true,

        message: "Compra finalizada com sucesso.",

        compra: compraAtualizada,

        itens: itensCriados,
      };
    } catch (error) {
      await client.query("ROLLBACK");

      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = CompraService;
