"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

function catalog(fetcher, token = "cliente-test") {
  const button = { dataset: {}, classList: { toggle() {} } };
  const list = { innerHTML: "" }, status = { textContent: "" };
  const context = vm.createContext({
    document: {
      addEventListener() {},
      querySelector: selector => selector === ".customer-notification-button" ? button : null,
      getElementById: id => id === "customerNotificationList" ? list : id === "customerNotificationStatus" ? status : null,
    },
    sessionStorage: { getItem: key => key === "petflow_customer_token" ? token : null },
    fetch: fetcher,
  });
  // Executa o arquivo real; não dispara o restante da página durante o teste.
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/js/pages/home/catalog.js"), "utf8"), context);
  const records = [{ id: "nova", titulo: "Novo protocolo", mensagem: "Resposta disponível", lida: false },
    { id: "antiga", titulo: "Pedido entregue", lida: true }];
  vm.runInContext("publicNotifications=" + JSON.stringify(records) + ";renderCustomerNotifications()", context);
  return { button, list, status, markRead: () => context.markCustomerNotificationsRead(),
    records: () => JSON.parse(vm.runInContext("JSON.stringify(publicNotifications)", context)) };
}

test("notificações permanecem não lidas após falha HTTP e só mudam após confirmação persistida", async () => {
  let statusCode = 401;
  const calls = [];
  const page = catalog(async (url, options) => {
    calls.push({ url, options });
    return { ok: statusCode >= 200 && statusCode < 300, status: statusCode };
  });
  const before = page.records(), markup = page.list.innerHTML;
  for (const failure of [401, 403, 429, 500, 503]) {
    statusCode = failure;
    await page.markRead();
    assert.deepEqual(page.records(), before);
    assert.equal(page.button.dataset.count, "1");
    assert.equal(page.status.textContent, "1 nova");
    assert.equal(page.list.innerHTML, markup);
  }
  statusCode = 200;
  await page.markRead();
  assert.ok(page.records().every(record => record.lida));
  assert.equal(page.button.dataset.count, undefined);
  assert.equal(page.status.textContent, "Nenhuma nova");
  assert.doesNotMatch(page.list.innerHTML, /is-unread/);
  for (const call of calls) {
    assert.equal(call.url, "/api/public/clientes/notificacoes/lidas");
    assert.equal(call.options.method, "PATCH");
    assert.equal(call.options.headers.Authorization, "Bearer cliente-test");
  }
});

test("falha de rede conserva a leitura e visitante não faz requisição autenticada", async () => {
  const page = catalog(async () => { throw new Error("conexão interrompida"); });
  const before = page.records();
  await page.markRead();
  assert.deepEqual(page.records(), before);
  assert.equal(page.button.dataset.count, "1");
  let calls = 0;
  const visitor = catalog(async () => { calls++; }, null);
  await visitor.markRead();
  assert.equal(calls, 0);
  assert.equal(visitor.button.dataset.count, "1");
});
