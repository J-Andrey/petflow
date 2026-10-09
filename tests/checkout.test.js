"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { load, response } = require("./helpers");
const id = "10000000-0000-0000-0000-000000000001", customer = { id: "customer", empresaId: "company" };
function checkoutFixture() {
    const state = { attempt: null, calls: 0 }, order = { id, empresa_id: "company", cliente_id: "customer", status: "AGUARDANDO_PAGAMENTO", reserva_expira_em: new Date(Date.now() + 600000) };
    const client = { async query(sql, params) {
        if (sql.includes("SELECT * FROM vendas")) return { rows: params[1] === order.empresa_id && (!params[2] || params[2] === order.cliente_id) ? [order] : [] };
        if (sql.includes("INSERT INTO checkout_tentativas")) {
            if (state.attempt && state.attempt.status !== "REJEITADA") return { rowCount: 0, rows: [] };
            state.attempt = { status: "INICIADA", chave_idempotencia: params[2] }; return { rowCount: 1, rows: [state.attempt] };
        }
        if (sql.includes("UPDATE checkout_tentativas")) {
            if (sql.includes("status='CONCLUIDA'")) state.attempt.status = "CONCLUIDA";
            else if (state.attempt.status !== "CONCLUIDA") state.attempt.status = params[2];
        }
        return { rows: [], rowCount: 0 };
    } };
    const db = { query: (...args) => client.query(...args), transaction: fn => fn(client) };
    const model = { async buscarPorIdDoCliente() { return order; }, async registrarPagamentoPagSeguro(saleId, company, data) { assert.equal(saleId, id); assert.equal(company, "company"); order.pagseguro_checkout_id = data.pagseguroCheckoutId; order.pagseguro_checkout_url = data.pagseguroCheckoutUrl; return order; } };
    const service = load("services/checkoutService.js", { "../models/vendaModel": model });
    const gateway = { async criarCheckout(sale, key) { state.calls++; assert.equal(sale.id, id); assert.equal(key, "petflow-checkout-" + id); return { checkoutId: "CHEC_test", checkoutUrl: "https://pagamento.pagbank.com.br/pagamento?code=test", status: "ACTIVE", raw: { reference_id: id } }; } };
    return { db, model, order, state, service, gateway };
}
test("rejeição comprovada permite corrigir e pagar mesmo pedido, sucesso reutiliza checkout", async () => {
    const f = checkoutFixture(), success = f.gateway.criarCheckout;
    f.gateway.criarCheckout = async () => { f.state.calls++; throw Object.assign(new Error("CPF recusado"), { paymentError: true, checkoutRejected: true, paymentErrorCode: "invalid_value", status: 400 }); };
    await assert.rejects(f.service.create(f.db, customer, id, f.gateway), /CPF recusado/);
    assert.equal(f.state.attempt.status, "REJEITADA");
    f.gateway.criarCheckout = success;
    await f.service.create(f.db, customer, id, f.gateway);
    assert.equal(f.state.attempt.status, "CONCLUIDA"); assert.equal(f.state.calls, 2);
    assert.equal((await f.service.create(f.db, customer, id, f.gateway)).reused, true); assert.equal(f.state.calls, 2);
});
test("timeout preserva intenção incerta e nunca repete criação de checkout", async () => {
    const f = checkoutFixture();
    f.gateway.criarCheckout = async () => { f.state.calls++; throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); };
    await assert.rejects(f.service.create(f.db, customer, id, f.gateway), /timeout/);
    assert.equal(f.state.attempt.status, "INCERTA");
    await assert.rejects(f.service.create(f.db, customer, id, f.gateway), /em conferência/);
    assert.equal(f.state.calls, 1);
});
test("pré-validação e ownership acontecem antes da chamada ao provedor", async () => {
    const f = checkoutFixture();
    f.gateway.validateCheckout = () => { throw Object.assign(new Error("Dados inválidos"), { paymentError: true, checkoutRejected: true }); };
    await assert.rejects(f.service.create(f.db, customer, id, f.gateway), /Dados inválidos/);
    assert.equal(f.state.attempt.status, "REJEITADA"); assert.equal(f.state.calls, 0);
    await assert.rejects(f.service.create(f.db, { ...customer, empresaId: "other" }, id, f.gateway), { status: 404 });
    assert.equal(f.state.calls, 0);
});
function gatewayFixture(transport = {}) {
    const requests = [];
    const gateway = load("services/pagseguroService.js", {
        "../config/env": { APP_URL: "https://loja.example", PAGSEGURO_BASE_URL: "https://api.pagseguro.com", PAGSEGURO_TOKEN: "unit-test-placeholder" },
        axios: { create(config) { assert.equal(config.baseURL, "https://api.pagseguro.com"); return { async post(path, payload) { requests.push({ path, payload }); if (transport.error) throw transport.error; return { data: transport.data || { id: "CHEC_test", reference_id: id, status: "ACTIVE", links: [{ rel: "PAY", href: "https://pagamento.pagbank.com.br/pagamento?code=test" }] } }; }, async get() { return { data: transport.data }; } }; } },
    });
    const order = { id, valor_final: "24.79", desconto: "0.79", acrescimo: "0", valor_frete: "5.00", reserva_expira_em: new Date(Date.now() + 600000), itens: [{ produto_id: "product", produto: "Ração", quantidade: 2, preco_unitario: "10.29" }], cliente: { nome: "Ana Teste", email: "ana@example.test", cpf: "529.982.247-25", telefone: "11999999999" }, endereco_entrega: { endereco: "Rua Teste", numero: "10", bairro: "Centro", cidade: "São Paulo", estado: "SP", cep: "01310-100" } };
    return { gateway, order, requests };
}
test("payload de produção usa CPF e centavos exatos; referência local não vira orderId", async () => {
    const f = gatewayFixture();
    const result = await f.gateway.criarCheckout(f.order, "test-key");
    assert.equal(result.orderId, null); assert.equal(result.checkoutId, "CHEC_test");
    const payload = f.requests[0].payload;
    assert.equal(payload.customer.tax_id, "52998224725"); assert.deepEqual(payload.customer.phone, { country: "+55", area: "11", number: "999999999" });
    assert.equal(payload.items[0].unit_amount, 1029); assert.equal(payload.discount_amount, 79); assert.equal(payload.shipping.amount, 500);
    assert.equal(payload.payment_notification_urls[0], "https://loja.example/api/public/pagamentos/webhook");
    assert.equal(payload.redirect_url, "https://loja.example/meus-pedidos?pagamento=retorno&pedido=" + id);
    assert.equal(payload.return_url, payload.redirect_url);
    assert.throws(() => f.gateway.validateCheckout({ ...f.order, valor_final: "24.80" }), /diverge/);
    assert.throws(() => f.gateway.validateCheckout({ ...f.order, desconto: "0.001" }), /monetário/);
});
test("credencial recusada e allowlist têm mensagem útil sem vazar dados ou invalidar login do cliente", async () => {
    for (const [status, code, pattern] of [[401, "invalid_authorization_header", /credencial/], [403, "allowlist_access_required", /liberação/]]) {
        const f = gatewayFixture({ error: { response: { status, data: { error_messages: [{ error: code, description: "secret token and customer data", parameter_name: "customer.tax_id" }] } } } });
        await assert.rejects(f.gateway.criarCheckout(f.order, "test-key"), error => error.status === 503 && error.checkoutRejected && pattern.test(error.message) && !error.message.includes("secret") && !Object.hasOwn(error, "details"));
    }
    const error = Object.assign(new Error("Credencial da loja recusada."), { paymentError: true, paymentErrorCode: "invalid_authorization_header", checkoutRejected: true, status: 503 });
    const controller = load("controllers/publicPaymentController.js", { "../models/vendaModel": {}, "../services/vendaService": {}, "../services/pagseguroService": {}, "../services/paymentReconciliationService": {}, "../database/connection": {}, "../services/checkoutService": { async create() { throw error; } } });
    const res = response(); await controller.criarPagamento({ customer, body: { vendaId: id } }, res, () => assert.fail("Erro sanitizado deve chegar ao cliente"));
    assert.equal(res.statusCode, 503); assert.equal(res.body.pagamento, "REJEITADO"); assert.match(res.body.message, /Credencial/);
});
test("consulta escolhe pagamento aprovado mesmo depois de tentativa de cartão recusada", async () => {
    const f = gatewayFixture({ data: { id: "CHEC_test", reference_id: id, status: "ACTIVE", orders: [{ id: "ORDE_declined", charges: [{ id: "CHAR_declined", status: "DECLINED", created_at: "2026-10-07T12:00:00Z" }] }, { id: "ORDE_paid", charges: [{ id: "CHAR_paid", status: "PAID", created_at: "2026-10-07T11:00:00Z" }] }] } });
    const result = await f.gateway.consultarCheckout("CHEC_test");
    assert.equal(result.status, "PAID"); assert.equal(result.chargeId, "CHAR_paid"); assert.equal(result.orderId, "ORDE_paid");
    assert.equal(f.gateway.mapStatusToVenda("DECLINED"), "AGUARDANDO_PAGAMENTO");
    assert.equal(f.gateway.extrairEventoWebhook({ id: "CHEC_test", reference_id: id, status: "ACTIVE" }).orderId, null);
});
function publicOrdersFixture() {
    const vm = require("node:vm"), fs = require("node:fs"), listeners = {}, elements = { publicOrdersList: { addEventListener(event, fn) { listeners[event] = fn; }, innerHTML: "" }, ordersStatus: { textContent: "" } };
    const context = vm.createContext({ document: { addEventListener() {}, getElementById(name) { return elements[name]; } }, sessionStorage: { getItem() { return "test-session"; } }, window: { location: { href: "/meus-pedidos" } }, URL, URLSearchParams, setTimeout, clearTimeout, console });
    vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "../public/js/pages/auth/public-auth.js"), "utf8"), context);
    return { context, listeners, elements };
}
test("Meus pedidos recupera pedido sem checkout com botão de pagamento, sem recriar compra", async () => {
    const f = publicOrdersFixture(), calls = [];
    assert.match(f.context.renderContinuePayment({ id, status: "AGUARDANDO_PAGAMENTO" }), /Pagar este pedido/);
    assert.doesNotMatch(f.context.renderContinuePayment({ id, status: "CANCELADA" }), /data-pay-order/);
    assert.doesNotMatch(f.context.renderContinuePayment({ id, status: "AGUARDANDO_PAGAMENTO", reserva_expira_em: "2020-01-01" }), /data-pay-order/);
    f.context.request = async (path, method, body) => { calls.push({ path, method, body }); return path === "/pagamentos" ? { payment: { checkoutUrl: "https://pagamento.pagbank.com.br/pagamento?code=test" } } : { data: [{ id, status: "AGUARDANDO_PAGAMENTO", itens: [] }] }; };
    await f.context.setupPublicOrders();
    const button = { dataset: { payOrder: id }, disabled: false };
    await f.listeners.click({ target: { closest() { return button; } } });
    assert.equal(f.context.window.location.href, "https://pagamento.pagbank.com.br/pagamento?code=test");
    assert.equal(calls.filter(call => call.path === "/pagamentos" && call.method === "POST").length, 1);
    assert.equal(calls.some(call => call.path === "/pedidos"), false); assert.equal(button.disabled, false);
});
test("Meus pedidos mostra falha real do PagBank sem redirecionar ou perder referência", async () => {
    const f = publicOrdersFixture();
    f.context.request = async path => { if (path === "/pagamentos") throw new Error("O PagBank recusou o CPF."); return { data: [] }; };
    await f.context.setupPublicOrders();
    await f.listeners.click({ target: { closest() { return { dataset: { payOrder: id } }; } } });
    assert.equal(f.context.window.location.href, "/meus-pedidos");
    assert.match(f.elements.ordersStatus.textContent, /10000000.*PagBank recusou o CPF/);
});
