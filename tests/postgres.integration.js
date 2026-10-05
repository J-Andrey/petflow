"use strict";
// Este arquivo é executado separadamente. Não carrega dotenv ou DATABASE_URL.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Pool } = require("pg"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const connectionString = process.env.TEST_DATABASE_URL;
const expected = process.env.TEST_DATABASE_NAME;
if (
  !connectionString ||
  !expected ||
  !/^petflow_test[a-z0-9_]*$/.test(expected)
)
  throw new Error(
    "Defina TEST_DATABASE_URL e TEST_DATABASE_NAME com prefixo petflow_test.",
  );
const url = new URL(connectionString);
if (decodeURIComponent(url.pathname.slice(1)) !== expected)
  throw new Error("Banco de testes divergente.");
const pool = new Pool({
  connectionString,
  max: 8,
  connectionTimeoutMillis: 5000,
});
test.after(() => pool.end());
test("PostgreSQL: migrações, reservas, concorrência, sessões e isolamento", async () => {
  const check = await pool.query("SELECT current_database() AS name");
  assert.equal(check.rows[0].name, expected);
  const existing = await pool.query(
    "SELECT to_regclass('public.usuarios') AS users",
  );
  assert.equal(
    existing.rows[0].users,
    null,
    "Use um banco de testes vazio, sem dados operacionais.",
  );
  const dir = path.join(__dirname, "../database/sql");
  await pool.query(
    "CREATE TABLE schema_migrations(nome VARCHAR(255) PRIMARY KEY,checksum VARCHAR(64) NOT NULL,aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  );
  for (const file of (await fs.readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(nome,checksum) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [file, crypto.createHash("sha256").update(sql).digest("hex")],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(file + ": " + error.message);
    } finally {
      client.release();
    }
  }
  const db = {
    query: (...args) => pool.query(...args),
    connect: () => pool.connect(),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const company = (await pool.query("SELECT get_petflow_empresa_id() AS id"))
    .rows[0].id;
  const other = (
    await pool.query(
      "INSERT INTO empresas(nome) VALUES('Teste outra empresa') RETURNING id",
    )
  ).rows[0].id;
  const admin = (
    await pool.query(
      "INSERT INTO usuarios(empresa_id,nome,email,senha_hash,perfil) VALUES($1,'Admin Teste','admin@example.test','hash','ADMIN') RETURNING *",
      [company],
    )
  ).rows[0];
  await pool.query("UPDATE usuarios SET perfil='GERENTE' WHERE id=$1", [
    admin.id,
  ]);
  assert.equal(
    (
      await pool.query("SELECT sessao_versao FROM usuarios WHERE id=$1", [
        admin.id,
      ])
    ).rows[0].sessao_versao,
    admin.sessao_versao + 1,
  );
  const customer = (
    await pool.query(
      "INSERT INTO clientes(empresa_id,nome,cpf,email,telefone,whatsapp,cep,endereco,numero,bairro,cidade,estado) VALUES($1,'Cliente Teste','529.982.247-25','cliente@example.test','11999999999','11999999999','01310100','Rua Teste','10','Centro','São Paulo','SP') RETURNING *",
      [company],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO usuarios_clientes(cliente_id,email,senha_hash,email_verificado) VALUES($1,$2,'hash',TRUE)",
    [customer.id, customer.email],
  );
  const secondCustomer = (
    await pool.query(
      "INSERT INTO clientes(empresa_id,nome,cpf,email,telefone,whatsapp) VALUES($1,'Outro Cliente','111.444.777-35','outro@example.test','11988888888','11988888888') RETURNING id",
      [company],
    )
  ).rows[0].id;
  const category = (
    await pool.query(
      "INSERT INTO categorias(empresa_id,nome) VALUES($1,'Teste') RETURNING id",
      [company],
    )
  ).rows[0].id;
  const product = (
    await pool.query(
      "INSERT INTO produtos(empresa_id,categoria_id,nome,preco) VALUES($1,$2,'Produto Teste',10) RETURNING id",
      [company, category],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO estoque(empresa_id,produto_id,quantidade) VALUES($1,$2,2)",
    [company, product],
  );
  const secret = "integration-test-only";
  // Injeta somente o banco local isolado e um segredo descartável nas unidades reais.
  function inject(file, value) {
    const filename = require.resolve(file);
    require.cache[filename] = {
      id: filename,
      filename,
      loaded: true,
      exports: value,
    };
  }
  inject("../database/connection", db);
  inject("../config/env", {
    JWT_SECRET: secret,
    JWT_EXPIRES_IN: "1h",
    APP_URL: "https://example.test",
  });
  inject("../services/emailService", { sendOptionalEmail: async () => null });
  const saleService = require("../services/vendaService");
  const jwt = require("jsonwebtoken");
  const address = require("../services/deliveryService").normalizeAddress(
    customer,
  );
  const quote = jwt.sign(
    { empresaId: company, address, distance: 2000, cents: 500 },
    secret,
    { expiresIn: "15m", audience: "petflow:frete", issuer: "petflow" },
  );
  const sale = {
    cliente_id: customer.id,
    forma_pagamento: "PAGBANK",
    cotacao_frete: quote,
    endereco_entrega: address,
  };
  const results = await Promise.allSettled([
    saleService.finalizarVenda(company, sale, [
      { produto_id: product, quantidade: 2 },
    ]),
    saleService.finalizarVenda(
      company,
      { ...sale, cliente_id: secondCustomer },
      [{ produto_id: product, quantidade: 2 }],
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const order = results.find((r) => r.status === "fulfilled").value.venda;
  assert.equal(Number(order.valor_final), 25);
  assert.equal(order.endereco_entrega.numero, "10");
  const model = require("../models/vendaModel");
  assert.equal(await model.buscarPorId(order.id, other), undefined);
  await assert.rejects(
    pool.query("UPDATE estoque SET quantidade=0 WHERE produto_id=$1", [
      product,
    ]),
  );
  await Promise.all([
    saleService.confirmarPagamento(company, order.id, {
      pagseguroStatus: "PAID",
    }),
    saleService.confirmarPagamento(company, order.id, {
      pagseguroStatus: "PAID",
    }),
  ]);
  assert.equal(
    (
      await pool.query("SELECT quantidade FROM estoque WHERE produto_id=$1", [
        product,
      ])
    ).rows[0].quantidade,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT COUNT(*)::integer AS n FROM financeiro WHERE referencia_id=$1",
        [order.id],
      )
    ).rows[0].n,
    1,
  );
  await saleService.atualizarStatusPedido(company, order.id, "EM_SEPARACAO");
  await saleService.atualizarStatusPedido(
    company,
    order.id,
    "SAIU_PARA_ENTREGA",
  );
  await saleService.atualizarStatusPedido(company, order.id, "ENTREGUE");
  await saleService.confirmarPagamento(company, order.id, {
    pagseguroStatus: "PAID",
  });
  assert.equal((await model.buscarPorId(order.id, company)).status, "ENTREGUE");
  assert.equal(
    (
      await pool.query(
        "SELECT COUNT(*)::integer AS n FROM movimentacoes_estoque WHERE produto_id=$1 AND tipo='SAIDA'",
        [product],
      )
    ).rows[0].n,
    1,
  );
  const auth = require("../models/authModel");
  await pool.query(
    "UPDATE usuarios SET perfil='ADMIN',token_recuperacao=$1,token_expiracao=NOW()+INTERVAL '1 hour' WHERE id=$2",
    [require("../services/sessionService").hashToken("single-use"), admin.id],
  );
  const consumed = await Promise.all([
    auth.consumePasswordResetToken("single-use", "newhash"),
    auth.consumePasswordResetToken("single-use", "anotherhash"),
  ]);
  assert.equal(consumed.filter(Boolean).length, 1);
  assert.equal(await require("../services/healthService").readiness(db), true);
  const actor = {
    user: { id: admin.id, empresaId: company, sessao_versao: 10 },
    ip: "127.0.0.1",
    body: { motivo: "Cancelamento solicitado no teste." },
  };
  const cancellations = require("../services/cancellationService");
  const denied = await cancellations.requestCancellation(
    db,
    actor,
    order.id,
    {},
  );
  assert.equal(denied.status, "ATENDIMENTO");
  assert.match(denied.protocolo, /^SAC-/);
  await pool.query("UPDATE estoque SET quantidade=3 WHERE produto_id=$1", [
    product,
  ]);
  const refundOrder = (
    await saleService.finalizarVenda(company, sale, [
      { produto_id: product, quantidade: 1 },
    ])
  ).venda;
  await pool.query(
    "UPDATE vendas SET pagseguro_charge_id='CHAR_TEST' WHERE id=$1",
    [refundOrder.id],
  );
  await saleService.confirmarPagamento(company, refundOrder.id, {
    pagseguroStatus: "PAID",
  });
  let gatewayCalls = 0,
    refunded = 0;
  const gateway = {
    async consultarCobranca() {
      return { id: "CHAR_TEST", amount: { summary: { refunded } } };
    },
    async reembolsar(id, cents, key) {
      gatewayCalls++;
      assert.equal(key, "petflow-refund-" + refundOrder.id);
      refunded = cents;
      return { id, amount: { summary: { refunded } } };
    },
  };
  const refundResults = await Promise.all([
    cancellations.requestCancellation(db, actor, refundOrder.id, gateway),
    cancellations.requestCancellation(db, actor, refundOrder.id, gateway),
  ]);
  assert.equal(gatewayCalls, 1);
  assert.ok(refundResults.every((r) => r.status === "CANCELADA"));
  assert.equal(
    (
      await pool.query("SELECT quantidade FROM estoque WHERE produto_id=$1", [
        product,
      ])
    ).rows[0].quantidade,
    3,
  );
  const expiring = (
    await saleService.finalizarVenda(company, sale, [
      { produto_id: product, quantidade: 1 },
    ])
  ).venda;
  await pool.query(
    "UPDATE vendas SET reserva_expira_em=NOW()-INTERVAL '1 minute' WHERE id=$1",
    [expiring.id],
  );
  const reservations = require("../services/reservationService");
  assert.equal(await reservations.expire(), 1);
  assert.equal(await reservations.expire(), 0);
  const pet = (
    await pool.query(
      "INSERT INTO pets(empresa_id,cliente_id,nome,especie) VALUES($1,$2,'Pet Teste','CACHORRO') RETURNING id",
      [company, customer.id],
    )
  ).rows[0].id;
  const serviceId = (
    await pool.query(
      "INSERT INTO servicos(empresa_id,nome,preco,duracao) VALUES($1,'Banho Teste',30,60) RETURNING id",
      [company],
    )
  ).rows[0].id;
  const schedule = require("../services/scheduleService");
  const date = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
  const appointment = {
    clienteId: customer.id,
    petId: pet,
    servicoId: serviceId,
    data: date,
    hora: "10:00",
    status: "AGENDADO",
  };
  const appointments = await Promise.allSettled([
    schedule.save(db, actor, appointment),
    schedule.save(db, actor, { ...appointment, hora: "10:30" }),
  ]);
  assert.equal(appointments.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(appointments.filter((r) => r.status === "rejected").length, 1);
  const tracking = require("../services/trackingService");
  const deliveryOrder = (
    await saleService.finalizarVenda(company, sale, [
      { produto_id: product, quantidade: 1 },
    ])
  ).venda;
  await saleService.confirmarPagamento(company, deliveryOrder.id, {
    pagseguroStatus: "PAID",
  });
  await saleService.atualizarStatusPedido(
    company,
    deliveryOrder.id,
    "EM_SEPARACAO",
  );
  await saleService.atualizarStatusPedido(
    company,
    deliveryOrder.id,
    "SAIU_PARA_ENTREGA",
  );
  const first = await tracking.createLink(db, actor, deliveryOrder.id),
    second = await tracking.createLink(db, actor, deliveryOrder.id);
  const oldToken = first.url.split("#")[1],
    newToken = second.url.split("#")[1];
  await assert.rejects(tracking.driver(db, oldToken), { status: 401 });
  await tracking.position(db, newToken, {
    latitude: -23.5,
    longitude: -46.6,
    precisao_m: 10,
    observado_em: Date.now(),
  });
  const point = await tracking.driver(db, newToken);
  assert.equal(point.latitude, -23.5);
  assert.notEqual(point.token_hash, newToken);
  await saleService.atualizarStatusPedido(
    company,
    deliveryOrder.id,
    "ENTREGUE",
  );
  await assert.rejects(tracking.driver(db, newToken), { status: 401 });
  const clinical = require("../services/clinicalService");
  const consult = await clinical.save(
    db,
    {
      ...actor,
      body: {
        pet_id: pet,
        cliente_id: customer.id,
        data_consulta: date,
        horario: "11:00",
        motivo_consulta: "Exame de teste",
        status: "AGENDADA",
      },
    },
    "consultas",
  );
  await assert.rejects(
    clinical.save(
      db,
      {
        ...actor,
        user: { ...actor.user, empresaId: other },
        body: { consulta_id: consult.id, diagnostico: "Teste" },
      },
      "prontuarios",
    ),
  );
  const chart = await clinical.save(
    db,
    {
      ...actor,
      body: { consulta_id: consult.id, diagnostico: "Exame registrado" },
    },
    "prontuarios",
  );
  assert.equal(chart.empresa_id, company);
  await assert.rejects(
    pool.query("DELETE FROM consultas WHERE id=$1", [consult.id]),
  );

  const purchaseService = require("../services/compraService");
  const supplier = (
    await pool.query(
      "INSERT INTO fornecedores(empresa_id,nome,razao_social,cnpj) VALUES($1,'Fornecedor Teste','Fornecedor Teste','TEST-001') RETURNING id",
      [company],
    )
  ).rows[0].id;
  const otherSupplier = (
    await pool.query(
      "INSERT INTO fornecedores(empresa_id,nome,razao_social,cnpj) VALUES($1,'Outro Fornecedor','Outro Fornecedor','TEST-002') RETURNING id",
      [other],
    )
  ).rows[0].id;
  const purchase = { fornecedor_id: supplier, data_compra: date };
  const purchaseItems = [
    { produto_id: product, quantidade: 3, valor_unitario: "0.10" },
  ];
  const stockBefore = Number(
    (
      await pool.query("SELECT quantidade FROM estoque WHERE produto_id=$1", [
        product,
      ])
    ).rows[0].quantidade,
  );
  await assert.rejects(
    purchaseService.finalizarCompra(
      company,
      { ...purchase, fornecedor_id: otherSupplier },
      purchaseItems,
      actor,
    ),
    { status: 400 },
  );
  const purchased = await purchaseService.finalizarCompra(
    company,
    purchase,
    purchaseItems,
    actor,
  );
  assert.equal(Number(purchased.compra.valor_total), 0.3);
  assert.equal(
    Number(
      (
        await pool.query("SELECT quantidade FROM estoque WHERE produto_id=$1", [
          product,
        ])
      ).rows[0].quantidade,
    ),
    stockBefore + 3,
  );
  const payable = (
    await pool.query("SELECT * FROM financeiro WHERE referencia_id=$1", [
      purchased.compra.id,
    ])
  ).rows[0];
  assert.equal(Number(payable.valor), 0.3);
  const financial = require("../services/financialAdminService");
  await assert.rejects(
    financial.save(db, { ...actor, body: { valor: 1 } }, payable.id),
    { status: 409 },
  );
  await assert.rejects(financial.remove(db, actor, payable.id), {
    status: 409,
  });
  await financial.save(
    db,
    {
      ...actor,
      body: { status: "PAGO", valor_pago: "0.30", data_pagamento: date },
    },
    payable.id,
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM financeiro WHERE id=$1", [
        payable.id,
      ])
    ).rows[0].status,
    "PAGO",
  );

  const privacy = require("../services/privacyService");
  const retained = (
    await pool.query(
      "INSERT INTO lgpd_solicitacoes(protocolo,empresa_id,cliente_id,tipo) VALUES('TEST-RETAIN',$1,$2,'EXCLUSAO') RETURNING id",
      [company, customer.id],
    )
  ).rows[0].id;
  await assert.rejects(
    privacy.processRequest(
      db,
      { ...actor, body: { confirmacao: "PROCESSAR" } },
      retained,
    ),
    { status: 409 },
  );
  const fresh = (
    await pool.query(
      "INSERT INTO clientes(empresa_id,nome,cpf,email,telefone) VALUES($1,'Titular Teste','123.456.789-09','privacy@example.test','11977777777') RETURNING id",
      [company],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO usuarios_clientes(cliente_id,email,senha_hash,email_verificado) VALUES($1,'privacy@example.test','hash',TRUE)",
    [fresh],
  );
  const erasure = (
    await pool.query(
      "INSERT INTO lgpd_solicitacoes(protocolo,empresa_id,cliente_id,tipo) VALUES('TEST-ERASURE',$1,$2,'EXCLUSAO') RETURNING id",
      [company, fresh],
    )
  ).rows[0].id;
  await privacy.processRequest(
    db,
    { ...actor, body: { confirmacao: "PROCESSAR" } },
    erasure,
  );
  const scrubbed = (
    await pool.query("SELECT * FROM clientes WHERE id=$1", [fresh])
  ).rows[0];
  assert.equal(scrubbed.ativo, false);
  assert.equal(scrubbed.cpf, null);
  assert.equal(scrubbed.nome, "Titular anonimizado");
  assert.ok(scrubbed.anonimizado_em);
  await assert.rejects(
    privacy.processRequest(
      db,
      { ...actor, body: { confirmacao: "PROCESSAR" } },
      erasure,
    ),
    { status: 409 },
  );

  const vaccine = await clinical.save(
    db,
    { ...actor, body: { nome: "Vacina de teste", ativo: true } },
    "vacinas",
  );
  const due = (await pool.query("SELECT (CURRENT_DATE+3)::text AS date"))
    .rows[0].date;
  const today = (await pool.query("SELECT CURRENT_DATE::text AS date")).rows[0]
    .date;
  await clinical.save(
    db,
    {
      ...actor,
      body: {
        pet_id: pet,
        vacina_id: vaccine.id,
        data_aplicacao: today,
        proxima_dose: due,
      },
    },
    "historico_vacinas",
  );
  const reminders = require("../services/reminderService");
  await Promise.all([
    reminders.runDailyReminders(),
    reminders.runDailyReminders(),
  ]);
  assert.equal(
    (
      await pool.query(
        "SELECT COUNT(*)::integer AS n FROM notificacoes WHERE cliente_id=$1 AND chave_evento LIKE 'vacina-%'",
        [customer.id],
      )
    ).rows[0].n,
    1,
  );

  const checkoutService = require("../services/checkoutService");
  const checkoutOrder = (
    await saleService.finalizarVenda(company, sale, [
      { produto_id: product, quantidade: 1 },
    ])
  ).venda;
  const buyer = { id: customer.id, empresaId: company };
  let checkoutCalls = 0;
  const checkoutGateway = {
    async criarCheckout(order, key) {
      checkoutCalls++;
      assert.equal(key, "petflow-checkout-" + order.id);
      return {
        checkoutId: "CHEC_TEST_001",
        checkoutUrl: "https://example.test/payment",
        status: "ACTIVE",
        raw: { reference_id: order.id },
      };
    },
  };
  const checkoutResults = await Promise.allSettled([
    checkoutService.create(db, buyer, checkoutOrder.id, checkoutGateway),
    checkoutService.create(db, buyer, checkoutOrder.id, checkoutGateway),
  ]);
  assert.equal(checkoutCalls, 1);
  assert.ok(checkoutResults.some((result) => result.status === "fulfilled"));
  assert.equal(
    (await checkoutService.create(db, buyer, checkoutOrder.id, checkoutGateway))
      .reused,
    true,
  );
  assert.equal(checkoutCalls, 1);
  const uncertainOrder = (
    await saleService.finalizarVenda(company, sale, [
      { produto_id: product, quantidade: 1 },
    ])
  ).venda;
  let uncertainCalls = 0;
  const timeoutGateway = {
    async criarCheckout() {
      uncertainCalls++;
      throw new Error("Simulação: provedor aceitou e conexão caiu.");
    },
  };
  await assert.rejects(
    checkoutService.create(db, buyer, uncertainOrder.id, timeoutGateway),
  );
  await assert.rejects(
    checkoutService.create(db, buyer, uncertainOrder.id, timeoutGateway),
    { status: 409 },
  );
  assert.equal(uncertainCalls, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM checkout_tentativas WHERE venda_id=$1",
        [uncertainOrder.id],
      )
    ).rows[0].status,
    "INCERTA",
  );
  await assert.rejects(
    checkoutService.reconcile(db, actor, uncertainOrder.id, "CHEC_OTHER", {
      async consultarCheckout() {
        return { raw: { reference_id: checkoutOrder.id } };
      },
    }),
    { status: 409 },
  );
  await checkoutService.reconcile(
    db,
    actor,
    uncertainOrder.id,
    "CHEC_RECOVERED",
    {
      async consultarCheckout() {
        return {
          checkoutId: "CHEC_RECOVERED",
          checkoutUrl: "https://example.test/recovered",
          status: "ACTIVE",
          raw: { reference_id: uncertainOrder.id },
        };
      },
    },
  );
  assert.equal(
    (await checkoutService.create(db, buyer, uncertainOrder.id, timeoutGateway))
      .reused,
    true,
  );
  assert.equal(uncertainCalls, 1);
  await saleService.atualizarStatusPagamento(company, order.id, "CANCELADA", {
    pagseguroStatus: "CHARGEBACK",
  });
  await saleService.atualizarStatusPagamento(company, order.id, "CANCELADA", {
    pagseguroStatus: "CHARGEBACK",
  });
  assert.equal((await model.buscarPorId(order.id, company)).status, "ENTREGUE");
  assert.equal(
    (
      await pool.query(
        "SELECT COUNT(*)::integer AS n FROM notificacoes_admin WHERE empresa_id=$1 AND titulo='Pagamento exige conciliação'",
        [company],
      )
    ).rows[0].n,
    1,
  );
});
