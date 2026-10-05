"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { load } = require("./helpers");
const service = load("services/financialAdminService.js", {
  "../models/financeiroModel": {},
});
const manual = {
  descricao: "Aluguel",
  tipo: "PAGAR",
  origem: "MANUAL",
  valor: "100.20",
  valor_pago: 0,
  data_vencimento: "2026-10-10",
  status: "PENDENTE",
};
test("financeiro aceita valores em centavos e rejeita precisão e valores inválidos", () => {
  assert.equal(service.prepare(manual).valor, 100.2);
  for (const valor of [NaN, Infinity, -1, "", null, true, "1.001", "1e3"])
    assert.throws(() => service.prepare({ ...manual, valor }), { status: 400 });
});
test("financeiro não permite forjar vínculo nem editar lançamento de venda", () => {
  for (const origem of ["VENDA", "PEDIDO", "COMPRA"])
    assert.throws(() => service.prepare({ ...manual, origem }), {
      status: 400,
    });
  assert.throws(() => service.prepare(manual, { ...manual, origem: "VENDA" }), {
    status: 409,
  });
  assert.throws(
    () => service.prepare({ ...manual, referencia_id: "qualquer" }),
    { status: 400 },
  );
});
test("compra permite registrar pagamento, preservando valor, origem e vínculo", () => {
  const before = { ...manual, origem: "COMPRA", referencia_id: "a-reference" };
  assert.equal(
    service.prepare(
      { status: "PAGO", valor_pago: "100.20", data_pagamento: "2026-10-10" },
      before,
    ).referencia_id,
    "a-reference",
  );
  for (const body of [
    { valor: 50 },
    { referencia_id: null },
    { origem: "MANUAL" },
    { tipo: "RECEBER" },
    { status: "CANCELADO" },
  ])
    assert.throws(() => service.prepare(body, before), { status: 409 });
});
test("financeiro rejeita data impossível, pagamento excedente e status inconsistente", () => {
  for (const change of [
    { data_vencimento: "2026-02-30" },
    { valor_pago: 101 },
    { status: "PAGO" },
    { status: "CANCELADO", valor_pago: 1 },
    { valor_pago: "100.20" },
  ])
    assert.throws(() => service.prepare({ ...manual, ...change }), {
      status: 400,
    });
});
test("itens não podem sofrer escrita independente da operação principal", () => {
  const response = require("./helpers").response();
  require("../middlewares/immutableItemsMiddleware")({}, response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.success, false);
});
