"use strict";
const model = require("../models/financeiroModel");
const audit = require("./auditService");
const { UUID } = require("./sessionService");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

function cents(value) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === "" ||
    !/^\d+(\.\d{1,2})?$/.test(String(value))
  )
    fail("Informe um valor monetário válido com até duas casas decimais.");
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || result < 0 || result > 9999999999)
    fail("Valor monetário fora do limite.");
  return result;
}
function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validate(data) {
  const total = cents(data.valor),
    paid = cents(data.valor_pago ?? 0);
  if (total <= 0 || paid > total)
    fail("O valor deve ser positivo e o pagamento não pode superar o total.");
  if (
    !["PAGAR", "RECEBER"].includes(data.tipo) ||
    !["PENDENTE", "ATRASADO", "PAGO", "CANCELADO"].includes(data.status)
  )
    fail("Tipo ou status financeiro inválido.");
  if (
    typeof data.descricao !== "string" ||
    !data.descricao.trim() ||
    data.descricao.length > 2000
  )
    fail("Informe uma descrição de até 2000 caracteres.");
  if (
    !validDate(data.data_vencimento) ||
    (data.data_pagamento && !validDate(data.data_pagamento))
  )
    fail("Informe datas válidas.");
  if (
    (data.status === "PAGO" && (paid !== total || !data.data_pagamento)) ||
    (data.status === "CANCELADO" && paid !== 0) ||
    (["PENDENTE", "ATRASADO"].includes(data.status) && paid === total)
  )
    fail("Valor pago, data e status são inconsistentes.");
  if (
    data.observacoes != null &&
    (typeof data.observacoes !== "string" || data.observacoes.length > 2000)
  )
    fail("Observações limitadas a 2000 caracteres.");
  return {
    ...data,
    valor: total / 100,
    valor_pago: paid / 100,
    descricao: data.descricao.trim(),
  };
}
function prepare(body, before) {
  const data = { ...before, ...body };
  if (["VENDA", "PEDIDO", "ESTORNO", "CHARGEBACK", "REVERSAO_CHARGEBACK"].includes(before?.origem))
    fail("Este lançamento é controlado pelo pagamento do pedido.", 409);
  if (before?.referencia_id || before?.origem === "COMPRA") {
    for (const key of ["origem", "referencia_id", "tipo", "valor"]) {
      if (
        Object.hasOwn(body, key) &&
        (key === "valor"
          ? cents(body[key]) !== cents(before[key])
          : body[key] !== before[key])
      )
        fail(
          "A origem, o valor e o vínculo da compra não podem ser alterados.",
          409,
        );
    }
    if (data.status === "CANCELADO")
      fail("Cancele a compra pelo fluxo de estoque e financeiro.", 409);
  } else {
    if (
      body.referencia_id ||
      (body.origem && !["MANUAL", "SERVICO"].includes(body.origem))
    )
      fail("Lançamentos de pedidos e compras são criados pelo sistema.");
    data.origem = body.origem || before?.origem || "MANUAL";
    data.referencia_id = null;
  }
  for (const key of ["data_vencimento", "data_pagamento"])
    if (data[key] instanceof Date)
      data[key] = data[key].toISOString().slice(0, 10);
  data.status ||= "PENDENTE";
  return validate(data);
}
async function save(db, req, id) {
  if (id && !UUID.test(id)) fail("Identificador inválido.");
  return db.transaction(async (client) => {
    const before = id
      ? (
          await client.query(
            "SELECT * FROM financeiro WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
            [id, req.user.empresaId],
          )
        ).rows[0]
      : null;
    if (id && !before) fail("Lançamento não encontrado.", 404);
    const data = {
      ...prepare(req.body, before),
      empresa_id: req.user.empresaId,
    };
    const saved = id
      ? await model.atualizar(id, req.user.empresaId, data, client)
      : await model.criar(data, client);
    await audit.record(
      client,
      req,
      id ? "ATUALIZAR" : "CRIAR",
      "financeiro",
      saved.id,
      before,
      saved,
    );
    return saved;
  });
}
async function remove(db, req, id) {
  if (!UUID.test(id)) fail("Identificador inválido.");
  return db.transaction(async (client) => {
    const before = (
      await client.query(
        "SELECT * FROM financeiro WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
        [id, req.user.empresaId],
      )
    ).rows[0];
    if (!before) fail("Lançamento não encontrado.", 404);
    if (
      before.referencia_id ||
      ["VENDA", "PEDIDO", "COMPRA", "ESTORNO", "CHARGEBACK", "REVERSAO_CHARGEBACK"].includes(before.origem) ||
      cents(before.valor_pago) > 0
    )
      fail("Lançamento vinculado ou pago deve ser preservado.", 409);
    const saved = await model.atualizar(
      id,
      req.user.empresaId,
      { ...before, status: "CANCELADO", valor_pago: 0 },
      client,
    );
    await audit.record(
      client,
      req,
      "CANCELAR",
      "financeiro",
      id,
      before,
      saved,
    );
    return saved;
  });
}
module.exports = { save, remove, prepare, cents };
