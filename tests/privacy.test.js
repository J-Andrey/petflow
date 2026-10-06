"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { load } = require("./helpers");
const customer = {
  id: "11111111-1111-4111-8111-111111111111",
  empresaId: "22222222-2222-4222-8222-222222222222",
};
const secret = {
  senha_hash: "segredo",
  token_recuperacao: "segredo",
  token_hash: "segredo",
  usuario_id: "terceiro",
  atendida_por: "terceiro",
  ip_hash: "segredo",
  pagseguro_response: { token: "segredo" },
};
function service(email = async () => null, audit = async () => null) {
  return load("services/privacyService.js", {
    "./emailQueueService": { enqueueEmail: email },
    "./auditService": { record: audit },
  });
}

test("exportação inclui registros clínicos, itens, atendimento e conta com campos explícitos", async () => {
  const records = {
    clientes: [
      {
        id: customer.id,
        nome: "Ana",
        email: "ana@example.test",
        empresa_id: customer.empresaId,
        ...secret,
      },
    ],
    usuarios_clientes: [
      {
        email: "ana@example.test",
        email_verificado: true,
        ultimo_login: "2026-10-05",
        ...secret,
      },
    ],
    pets: [
      {
        id: "pet",
        nome: "Tico",
        microchip: "chip",
        alergias: "alergia",
        data_nascimento: "2020-01-01",
        foto: "https://example.test/pet.jpg",
        ...secret,
      },
    ],
    agendamentos: [
      { id: "agenda", pet_id: "pet", observacoes: "Banho", ...secret },
    ],
    consultas: [
      {
        id: "consulta",
        pet_id: "pet",
        motivo_consulta: "Exame",
        peso: "5.00",
        ...secret,
      },
    ],
    prontuarios: [
      {
        id: "prontuario",
        consulta_id: "consulta",
        diagnostico: "Diagnóstico",
        receita: "Receita",
        ...secret,
      },
    ],
    historico_vacinas: [
      {
        id: "aplicacao",
        pet_id: "pet",
        vacina_id: "vacina",
        consulta_id: "consulta",
        lote: "L1",
        ...secret,
      },
    ],
    vacinas: [{ id: "vacina", nome: "Vacina", ...secret }],
    vendas: [
      {
        id: "pedido",
        valor_final: "20.00",
        endereco_entrega: {
          cep: "01310100",
          endereco: "Rua A",
          numero: "1",
          token: "segredo",
          telefone_entregador: "terceiro",
          complemento: { token: "segredo" },
        },
        ...secret,
      },
    ],
    itens_venda: [
      {
        id: "item",
        venda_id: "pedido",
        quantidade: 2,
        produto_id: "produto",
        produto: "Ração",
        ...secret,
      },
    ],
    historico_pedidos: [
      { venda_id: "pedido", status_novo: "ENTREGUE", ...secret },
    ],
    reembolsos: [
      {
        venda_id: "pedido",
        status: "CONCLUIDO",
        motivo: "Devolução",
        provedor_id: "segredo",
        chave_idempotencia: "segredo",
        ...secret,
      },
    ],
    financeiro: [
      {
        referencia_id: "pedido",
        origem: "VENDA",
        valor_pago: "20.00",
        ...secret,
      },
    ],
    checkout_tentativas: [
      {
        venda_id: "pedido",
        status: "CONCLUIDA",
        chave_idempotencia: "segredo",
        ...secret,
      },
    ],
    conciliacao_eventos: [
      {
        id: "evento",
        venda_id: "pedido",
        tipo: "ESTORNO",
        valor_centavos: 100,
        evidencia: {
          charge_id: "charge",
          estornado_centavos: 100,
          token: "segredo",
          cartao: { numero: "segredo" },
          status: { token: "segredo" },
        },
        ...secret,
      },
    ],
    disputas_pagamento: [
      {
        id: "disputa",
        venda_id: "pedido",
        status_provedor: "LOST",
        perda_centavos: 100,
        ...secret,
      },
    ],
    devolucoes: [
      {
        id: "devolucao",
        venda_id: "pedido",
        motivo: "Devolução",
        aprovada_por: "terceiro",
        ...secret,
      },
    ],
    devolucao_itens: [
      {
        devolucao_id: "devolucao",
        produto_id: "produto",
        quantidade: 1,
        repor_estoque: true,
        ...secret,
      },
    ],
    notificacoes: [
      {
        titulo: "Resposta",
        mensagem: "Protocolo atendido",
        venda_id: "pedido",
        ...secret,
      },
    ],
    lgpd_consentimentos: [
      { finalidade: "NEWSLETTER", concedido: true, ...secret },
    ],
    lgpd_solicitacoes: [
      { protocolo: "LGPD-1", resposta: "Cópia disponível", ...secret },
    ],
    solicitacoes_consumidor: [
      {
        protocolo: "SAC-1",
        venda_id: "pedido",
        motivo: "Devolução",
        ...secret,
      },
    ],
    newsletter_inscritos: [
      { email: "ana@example.test", status: "ATIVO", ...secret },
    ],
  };
  const queries = [];
  const db = {
    transaction: async (fn) =>
      fn({
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
          assert.deepEqual(params, [customer.id, customer.empresaId]);
          assert.ok(sql.includes("$1") && sql.includes("$2"));
          assert.doesNotMatch(sql, /SELECT\s+\*/i);
          const table = /\bFROM (\w+)/.exec(sql)[1];
          return { rows: records[table] || [] };
        },
      }),
  };
  const data = await service().exportCustomerData(db, customer);
  assert.equal(
    queries[0].sql,
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  assert.equal(data.perfil.nome, "Ana");
  assert.equal(data.conta.email_verificado, true);
  assert.equal(data.pets[0].microchip, "chip");
  assert.equal(data.prontuarios[0].receita, "Receita");
  assert.equal(data.vacinacoes[0].vacina_id, "vacina");
  assert.equal(data.vacinacoes[0].consulta_id, "consulta");
  assert.equal(data.vacinas[0].id, "vacina");
  assert.equal(data.itens_pedidos[0].produto, "Ração");
  assert.equal(data.solicitacoes_atendimento[0].protocolo, "SAC-1");
  assert.equal(data.notificacoes[0].venda_id, "pedido");
  assert.deepEqual(data.conciliacoes[0].evidencia, {
    charge_id: "charge",
    estornado_centavos: 100,
  });
  assert.equal(data.disputas_pagamento[0].perda_centavos, 100);
  assert.equal(data.itens_devolucoes[0].devolucao_id, "devolucao");
  assert.deepEqual(data.pedidos[0].endereco_entrega, {
    cep: "01310100",
    endereco: "Rua A",
    numero: "1",
  });
  assert.doesNotMatch(
    JSON.stringify(data),
    /segredo|terceiro|senha_hash|token_recuperacao|pagseguro_response|provedor_id|chave_idempotencia|ip_hash|atendida_por|usuario_id/,
  );
});

test("exportação rejeita cliente de outra empresa antes de buscar dados dependentes", async () => {
  let calls = 0;
  const db = {
    transaction: async (fn) =>
      fn({
        query: async (sql, params) => {
          calls++;
          if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
          assert.match(sql, /FROM clientes WHERE id=\$1 AND empresa_id=\$2$/);
          assert.deepEqual(params, [customer.id, "outra-empresa"]);
          return { rows: [] };
        },
      }),
  };
  await assert.rejects(
    service().exportCustomerData(db, {
      ...customer,
      empresaId: "outra-empresa",
    }),
    { status: 404 },
  );
  assert.equal(calls, 2);
});

function requestDb({ tipo = "EXCLUSAO", retention = false } = {}) {
  const writes = [],
    queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT \* FROM lgpd_solicitacoes/.test(sql))
        return {
          rows: [
            {
              id: "request",
              cliente_id: customer.id,
              tipo,
              status: "ABERTA",
              protocolo: "LGPD-1",
            },
          ],
        };
      if (/SELECT \* FROM clientes/.test(sql))
        return { rows: [{ id: customer.id, email: "ana@example.test" }] };
      if (/AS retention/.test(sql)) return { rows: [{ retention }] };
      if (/^(UPDATE|DELETE|INSERT)/.test(sql)) writes.push({ sql, params });
      return { rows: [] };
    },
  };
  let committed = false,
    rolledBack = false;
  return {
    client,
    writes,
    queries,
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    },
    transaction: async (fn) => {
      try {
        const value = await fn(client);
        committed = true;
        return value;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  };
}
const actor = {
  user: { id: "admin", empresaId: customer.empresaId },
  body: { confirmacao: "PROCESSAR" },
};

test("retenção bloqueia exclusão e anonimização sem alterar histórico nem enfileirar e-mail", async () => {
  for (const tipo of ["EXCLUSAO", "ANONIMIZACAO"]) {
    let emails = 0;
    const db = requestDb({ tipo, retention: true });
    await assert.rejects(
      service(async () => {
        emails++;
      }).processRequest(db, actor, "request"),
      { status: 409 },
    );
    assert.equal(db.writes.length, 0);
    assert.equal(emails, 0);
    assert.equal(db.rolledBack, true);
    const lock = db.queries.findIndex((q) =>
      /FROM pets.*FOR UPDATE/.test(q.sql),
    );
    const retention = db.queries.findIndex((q) => /AS retention/.test(q.sql));
    assert.ok(lock >= 0 && lock < retention);
    assert.match(db.queries[retention].sql, /FROM prontuarios/);
    assert.match(db.queries[retention].sql, /a\.cliente_id=\$1 OR EXISTS/);
  }
});

test("processamento cadastral revoga sessões e insere resposta no outbox na mesma transação", async () => {
  const db = requestDb();
  let email;
  await service(async (options, client) => {
    assert.equal(client, db.client);
    email = options;
  }).processRequest(db, actor, "request");
  assert.equal(db.committed, true);
  assert.equal(email.to, "ana@example.test");
  assert.equal(email.idempotencyKey, "lgpd-request");
  assert.match(
    db.writes.find((q) => q.sql.startsWith("UPDATE usuarios_clientes")).sql,
    /sessao_versao=sessao_versao\+1.*c\.empresa_id=\$3/,
  );
  assert.match(
    db.writes.find((q) => q.sql.startsWith("UPDATE pets")).sql,
    /microchip=NULL.*foto=NULL.*ativo=FALSE,status=FALSE/,
  );
  assert.equal(
    db.writes.some((q) =>
      /^DELETE FROM (consultas|prontuarios|historico_vacinas|vendas|lgpd_solicitacoes)/.test(
        q.sql,
      ),
    ),
    false,
  );
});

test("falha na fila reverte o processamento e revogação só aceita finalidade explícita", async () => {
  const db = requestDb();
  await assert.rejects(
    service(async () => {
      throw new Error("outbox indisponível");
    }).processRequest(db, actor, "request"),
    /outbox indisponível/,
  );
  assert.equal(db.committed, false);
  assert.equal(db.rolledBack, true);
  const revoke = requestDb({ tipo: "REVOGACAO", retention: true });
  await assert.rejects(service().processRequest(revoke, actor, "request"), {
    status: 409,
  });
  assert.equal(revoke.writes.length, 0);
  const valid = requestDb({ tipo: "REVOGACAO", retention: true });
  await service().processRequest(
    valid,
    { ...actor, body: { confirmacao: "PROCESSAR", finalidade: "NEWSLETTER" } },
    "request",
  );
  assert.equal(
    valid.writes.some((q) =>
      /^UPDATE (clientes|pets|usuarios_clientes)/.test(q.sql),
    ),
    false,
  );
  assert.equal(
    valid.queries.some((q) => /AS retention/.test(q.sql)),
    false,
  );
});
