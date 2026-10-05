"use strict";
const model = require("../models/compraModel");
const service = require("../services/compraService");
const db = require("../database/connection");
const audit = require("../services/auditService");
const { UUID } = require("../services/sessionService");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
module.exports = {
  async listar(req, res, next) {
    try {
      res.json(await model.listar(req.user.empresaId));
    } catch (error) {
      next(error);
    }
  },
  async buscarPorId(req, res, next) {
    try {
      if (!UUID.test(req.params.id)) fail("Identificador inválido.");
      const row = await model.buscarPorId(req.params.id, req.user.empresaId);
      if (!row) fail("Compra não encontrada.", 404);
      res.json(row);
    } catch (error) {
      next(error);
    }
  },
  async criar(req, res, next) {
    try {
      res
        .status(201)
        .json(
          await service.finalizarCompra(
            req.user.empresaId,
            req.body,
            req.body.itens,
            req,
          ),
        );
    } catch (error) {
      next(error);
    }
  },
  async atualizar(req, res, next) {
    try {
      if (!UUID.test(req.params.id)) fail("Identificador inválido.");
      const row = await db.transaction(async (client) => {
        const before = (
          await client.query(
            "SELECT * FROM compras WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
            [req.params.id, req.user.empresaId],
          )
        ).rows[0];
        if (!before) fail("Compra não encontrada.", 404);
        if (Object.keys(req.body).some((key) => key !== "observacoes"))
          fail(
            "Após o registro, somente as observações da compra podem ser alteradas.",
            409,
          );
        if (
          typeof req.body.observacoes !== "string" ||
          req.body.observacoes.length > 2000
        )
          fail("Informe observações de até 2000 caracteres.");
        const saved = (
          await client.query(
            "UPDATE compras SET observacoes=$1,updated_at=NOW() WHERE id=$2 AND empresa_id=$3 RETURNING *",
            [req.body.observacoes, req.params.id, req.user.empresaId],
          )
        ).rows[0];
        await audit.record(
          client,
          req,
          "ATUALIZAR_OBSERVACOES",
          "compras",
          saved.id,
          before,
          saved,
        );
        return saved;
      });
      res.json(row);
    } catch (error) {
      next(error);
    }
  },
  async excluir(req, res) {
    res
      .status(409)
      .json({
        success: false,
        message:
          "A compra registrada possui efeitos de estoque e financeiro e deve ser preservada. A exclusão avulsa não é permitida.",
      });
  },
};
