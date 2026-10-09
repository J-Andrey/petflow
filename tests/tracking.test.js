"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { load } = require("./helpers");
const tracking = load("services/trackingService.js", {
  "./auditService": { record: async () => null },
});
const token = "a".repeat(64);
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function page({
  secure = true,
  mapFailure = false,
  brokenMap = false,
  hash = "#" + token,
  savedState = null,
} = {}) {
  const nodes = Object.fromEntries(
    [
      "start",
      "stop",
      "voice",
      "privacy",
      "status",
      "gpsStatus",
      "mapStatus",
      "map",
      "navigation",
      "updated",
      "instruction",
      "metrics",
      "center",
      "route",
      "fullscreen",
    ].map((id) => [id, { hidden: false, textContent: "" }]),
  );
  const requests = [],
    timers = [],
    events = {},
    geo = { watched: 0, refreshed: 0, cleared: [] };
  let now = 1800000000000,
    shared = null,
    rejectPosition = false;
  const document = {
    hidden: false,
    getElementById: (id) => nodes[id],
    addEventListener: (name, fn) => {
      events[name] = fn;
    },
    createElement: () => ({}),
    head: {
      append: (script) => (mapFailure ? script.onerror() : script.onload()),
    },
  };
  const history = {
    state: savedState,
    replaceState(state) {
      this.state = state;
    },
  };
  class ClockDate extends Date {
    static now() {
      return now;
    }
  }
  const context = vm.createContext({
    URLSearchParams,
    Date: ClockDate,
    window: { isSecureContext: secure },
    document,
    history,
    location: { hash, search: "", pathname: "/entrega.html" },
    google: {
      maps: {
        Map: class {
          panTo() {}
        },
        Marker: class {
          constructor() {
            throw new Error("Falha do marcador");
          }
        },
      },
    },
    sessionStorage: { getItem: () => null },
    navigator: {
      geolocation: {
        watchPosition(success, error, options) {
          geo.watched++;
          geo.success = success;
          geo.error = error;
          geo.options = options;
          return 17;
        },
        clearWatch(id) {
          geo.cleared.push(id);
        },
        getCurrentPosition(success, error, options) {
          geo.refreshed++;
          geo.current = success;
          geo.currentError = error;
          geo.currentOptions = options;
        },
      },
    },
    setInterval: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/config"))
        return {
          ok: true,
          json: async () => ({
            key: mapFailure || brokenMap ? "test-browser-key" : null,
          }),
        };
      if (options.method === "POST") {
        if (rejectPosition)
          return {
            ok: false,
            status: 503,
            json: async () => ({ message: "Servidor indisponível" }),
          };
        shared = JSON.parse(options.body);
        return { ok: true, json: async () => ({ data: { atualizada: true } }) };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            ...(shared || {}),
            antiga: !shared,
            atualizado_em: shared ? new Date(now).toISOString() : null,
            navegacao_url:
              "https://www.google.com/maps/dir/?api=1&destination=Rua+A",
          },
        }),
      };
    },
  });
  await vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../public/js/pages/tracking.js"),
      "utf8",
    ),
    context,
  );
  await settle();
  return {
    nodes,
    requests,
    timers,
    geo,
    document,
    history,
    events,
    tick: (milliseconds) => {
      now += milliseconds;
    },
    now: () => now,
    rejectPosition: (value) => {
      rejectPosition = value;
    },
    fix: (accuracy = 10) =>
      geo.success({
        coords: {
          latitude: -23.5,
          longitude: -46.6,
          accuracy,
          heading: NaN,
          speed: null,
        },
        timestamp: now,
      }),
  };
}

test("GPS envia a primeira posição mesmo quando Google Maps falha e evita posições repetidas", async () => {
  const driver = await page({ mapFailure: true });
  assert.match(
    driver.nodes.mapStatus.textContent,
    /Não foi possível carregar o mapa/,
  );
  assert.equal(driver.timers.length, 3);
  driver.nodes.start.onclick();
  assert.equal(driver.geo.watched, 1);
  assert.equal(driver.geo.options.enableHighAccuracy, true);
  driver.fix();
  await settle();
  const posts = () =>
    driver.requests.filter((request) => request.options.method === "POST");
  assert.equal(posts().length, 1);
  const body = JSON.parse(posts()[0].options.body);
  assert.equal(body.latitude, -23.5);
  assert.equal(body.direcao, null);
  assert.equal(posts()[0].options.headers.Authorization, "Delivery " + token);
  assert.match(driver.nodes.gpsStatus.textContent, /GPS compartilhado/);
  assert.ok(
    driver.requests
      .filter(
        (request) =>
          request.url.includes("entregador") &&
          request.options.method === "GET",
      )
      .every((request) => request.url.endsWith("?rota=0")),
  );
  driver.tick(1000);
  driver.fix();
  await settle();
  assert.equal(posts().length, 1);
  driver.tick(5000);
  await driver.timers.find((timer) => timer.fn.name === "sendPosition").fn();
  assert.equal(posts().length, 2);
  driver.tick(5000);
  await driver.timers.find((timer) => timer.fn.name === "sendPosition").fn();
  assert.equal(posts().length, 2);
});

test("erro ao desenhar marcador não interrompe o envio independente do GPS", async () => {
  const driver = await page({ brokenMap: true });
  driver.nodes.start.onclick();
  driver.fix();
  await settle();
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    1,
  );
  assert.match(driver.nodes.gpsStatus.textContent, /GPS compartilhado/);
  assert.match(driver.nodes.mapStatus.textContent, /não conseguiu exibir/);
});

test("entregador parado obtém uma nova observação GPS sem inventar horário nem repetir posição antiga", async () => {
  const driver = await page();
  driver.nodes.start.onclick();
  driver.fix();
  await settle();
  const first = JSON.parse(
    driver.requests.find((request) => request.options.method === "POST").options
      .body,
  );
  driver.tick(15000);
  driver.timers.find((timer) => timer.fn.name === "refreshPosition").fn();
  assert.equal(driver.geo.refreshed, 1);
  assert.equal(driver.geo.currentOptions.maximumAge, 0);
  driver.geo.current({
    coords: {
      latitude: first.latitude,
      longitude: first.longitude,
      accuracy: first.precisao_m,
    },
    timestamp: driver.now(),
  });
  await settle();
  const posts = driver.requests.filter(
    (request) => request.options.method === "POST",
  );
  assert.equal(posts.length, 2);
  assert.equal(
    JSON.parse(posts[1].options.body).observado_em,
    first.observado_em + 15000,
  );
  driver.document.hidden = true;
  driver.events.visibilitychange();
  driver.tick(15000);
  driver.timers.find((timer) => timer.fn.name === "refreshPosition").fn();
  assert.equal(driver.geo.refreshed, 1);
});

test("HTTP inseguro e permissão negada oferecem instruções sem o poll apagar o erro de GPS", async () => {
  const insecure = await page({ secure: false });
  insecure.nodes.start.onclick();
  assert.equal(insecure.geo.watched, 0);
  assert.match(insecure.nodes.gpsStatus.textContent, /HTTPS/);
  assert.equal(insecure.nodes.start.hidden, false);
  const denied = await page();
  denied.nodes.start.onclick();
  denied.geo.error({ code: 1 });
  const message = denied.nodes.gpsStatus.textContent;
  assert.match(message, /Localização bloqueada/);
  assert.equal(denied.nodes.start.hidden, false);
  await denied.timers.find((timer) => timer.fn.name === "poll").fn();
  assert.equal(denied.nodes.gpsStatus.textContent, message);
  assert.deepEqual(denied.geo.cleared, [17]);
});

test("GPS impreciso não é compartilhado; falha de envio permite repetir e ocultar página pausa captura", async () => {
  const driver = await page();
  driver.nodes.start.onclick();
  driver.fix(500);
  await settle();
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    0,
  );
  assert.match(driver.nodes.gpsStatus.textContent, /impreciso/);
  driver.rejectPosition(true);
  driver.fix();
  await settle();
  assert.match(driver.nodes.gpsStatus.textContent, /não enviado/);
  driver.rejectPosition(false);
  driver.tick(5000);
  await driver.timers.find((timer) => timer.fn.name === "sendPosition").fn();
  assert.match(driver.nodes.gpsStatus.textContent, /GPS compartilhado/);
  driver.document.hidden = true;
  driver.events.visibilitychange();
  const requests = driver.requests.length;
  driver.tick(5000);
  driver.fix();
  await driver.timers.find((timer) => timer.fn.name === "sendPosition").fn();
  assert.equal(driver.requests.length, requests);
  assert.match(driver.nodes.gpsStatus.textContent, /segundo plano/);
  driver.document.hidden = false;
  driver.events.visibilitychange();
  assert.equal(driver.geo.watched, 2);
});

test("recarregar mantém link na aba e encerrar revoga o token sem novos envios", async () => {
  const initial = await page();
  assert.equal(initial.history.state.deliveryToken, token);
  const reload = await page({ hash: "", savedState: initial.history.state });
  assert.equal(
    reload.requests[0].options.headers.Authorization,
    "Delivery " + token,
  );
  reload.nodes.start.onclick();
  reload.fix();
  await settle();
  await reload.nodes.stop.onclick();
  assert.equal(reload.history.state, null);
  assert.ok(
    reload.requests.some((request) => request.options.method === "DELETE"),
  );
  const total = reload.requests.length;
  reload.tick(5000);
  for (const timer of reload.timers) await timer.fn();
  assert.equal(reload.requests.length, total);
  const invalid = await page({ hash: "" });
  assert.equal(invalid.requests.length, 0);
  assert.equal(invalid.nodes.start.disabled, true);
});

test("navegação externa usa endereço do pedido sem chave/token ou campos internos", () => {
  const result = new URL(
    tracking.navigationUrl({
      token_hash: token,
      endereco_entrega: {
        endereco: "Rua A & B",
        numero: "10",
        bairro: "Centro",
        cidade: "São Paulo",
        estado: "SP",
        cep: "01310100",
        token: "SEGREDO",
        complemento: "Não exportar",
      },
    }),
  );
  assert.equal(result.origin, "https://www.google.com");
  assert.equal(result.searchParams.get("api"), "1");
  assert.equal(result.searchParams.get("dir_action"), "navigate");
  assert.equal(result.searchParams.get("travelmode"), "driving");
  assert.match(result.searchParams.get("destination"), /Rua A & B, 10/);
  assert.doesNotMatch(result.toString(), /SEGREDO|Não exportar|api_key|a{64}/);
  assert.equal(tracking.navigationUrl({}), null);
});

test("primeiro GPS descarta rota da loja em cache e chamadas seguintes reutilizam rota GPS", async () => {
  const unit = tracking;
  const oldKey = process.env.GOOGLE_MAPS_API_KEY,
    oldOrigin = process.env.DELIVERY_ORIGIN_ADDRESS;
  process.env.GOOGLE_MAPS_API_KEY = "test-only";
  process.env.DELIVERY_ORIGIN_ADDRESS = "Loja teste";
  try {
    const now = new Date(),
      current = {
        venda_id: "pedido",
        token_hash: token,
        latitude: -23.5,
        longitude: -46.6,
        atualizado_em: now,
        observado_em: now,
        rota_solicitada_em: now,
        rota: { origem_gps_observado_em: null },
        endereco_entrega: { endereco: "Rua teste", numero: "1" },
      };
    let calls = 0;
    const updates = [];
    const db = {
      query: async (sql, params) => {
        updates.push({ sql, params });
      },
    };
    const fetcher = async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.deepEqual(body.origin, {
        location: { latLng: { latitude: -23.5, longitude: -46.6 } },
      });
      return {
        ok: true,
        json: async () => ({
          routes: [{ polyline: { encodedPolyline: "polyline" } }],
        }),
      };
    };
    const route = await unit.route(db, current, fetcher);
    assert.equal(calls, 1);
    assert.equal(route.origem_gps_observado_em, now.toISOString());
    assert.equal(updates[0].params[2], token);
    assert.equal(
      await unit.route(db, { ...current, rota: route }, fetcher),
      route,
    );
    assert.equal(calls, 1);
  } finally {
    if (oldKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = oldKey;
    if (oldOrigin === undefined) delete process.env.DELIVERY_ORIGIN_ADDRESS;
    else process.env.DELIVERY_ORIGIN_ADDRESS = oldOrigin;
  }
});

test("endpoint sem mapa ou sem posição não consulta Routes e não expõe token", async (t) => {
  const express = require("express");
  let routes = 0,
    latitude = null;
  const router = load("routes/trackingRoutes.js", {
    "../database/connection": {},
    "../services/trackingService": {
      ...tracking,
      driver: async () => ({
        token_hash: token,
        latitude,
        longitude: -46.6,
        endereco_entrega: { endereco: "Rua A", numero: "1" },
      }),
      route: async () => {
        routes++;
        return { distanceMeters: 100 };
      },
    },
    "../middlewares/customerAuthMiddleware": (req, res, next) => next(),
    "../middlewares/authMiddleware": (req, res, next) => next(),
  });
  const app = express();
  app.use("/api/entregas", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url =
    "http://127.0.0.1:" + server.address().port + "/api/entregas/entregador";
  const request = (path) =>
    fetch(url + path, { headers: { Authorization: "Delivery " + token } });
  const initial = await (await request("")).json();
  assert.equal(routes, 0);
  assert.ok(initial.data.navegacao_url);
  assert.equal(initial.data.token_hash, undefined);
  latitude = -23.5;
  await request("?rota=0");
  assert.equal(routes, 0);
  await request("");
  assert.equal(routes, 1);
});

async function trackingServer(t) {
  const express = require("express");
  const orderId = "11111111-1111-4111-8111-111111111111";
  const current = {
    venda_id: orderId,
    token_hash: tracking.hash(token),
    latitude: null,
    longitude: null,
    endereco_entrega: { endereco: "Rua de teste", numero: "1" },
  };
  const router = load("routes/trackingRoutes.js", {
    "../database/connection": {
      query: async () => ({ rows: [current] }),
    },
    "../services/trackingService": {
      ...tracking,
      driver: async (db, value) => {
        if (![token, "b".repeat(64)].includes(value))
          throw Object.assign(new Error("Link expirado ou revogado."), {
            status: 401,
          });
        return { ...current, token_hash: tracking.hash(value) };
      },
      position: async () => ({ atualizada: true }),
      route: async () => null,
    },
    "../middlewares/customerAuthMiddleware": (req, res, next) => {
      req.customer = { id: "cliente", empresaId: "empresa", type: "customer" };
      next();
    },
    "../middlewares/authMiddleware": (req, res, next) => {
      req.user = { id: "admin", empresaId: "empresa", type: "admin" };
      next();
    },
  });
  const app = express();
  app.use(express.json());
  app.use("/api/entregas", router);
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ success: false, message: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port + "/api/entregas/";
  return {
    orderId,
    request: (endpoint, authorization = "Delivery " + token, method = "GET") =>
      fetch(base + endpoint, {
        method,
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      }),
  };
}

test("GPS e acompanhamento na mesma rede não compartilham a cota de requisições", async (t) => {
  const { request, orderId } = await trackingServer(t);
  // Em um minuto: 12 polls por timer + 12 posições + 12 polls após enviar GPS.
  // O cliente acompanha com mais 12 polls pelo mesmo IP.
  for (let tick = 0; tick < 12; tick++) {
    for (const [endpoint, authorization, method] of [
      ["entregador?rota=0", "Delivery " + token, "GET"],
      ["entregador/localizacao", "Delivery " + token, "POST"],
      ["entregador?rota=0", "Delivery " + token, "GET"],
      ["cliente/" + orderId + "?rota=0", "Bearer cliente", "GET"],
    ]) {
      const response = await request(endpoint, authorization, method);
      assert.equal(response.status, 200, endpoint + " no intervalo " + tick);
      await response.json();
    }
  }
});

test("limite de um link privado não bloqueia outro link e retorna orientação JSON", async (t) => {
  const { request } = await trackingServer(t);
  for (let index = 0; index < 40; index++) {
    const response = await request("entregador?rota=0");
    assert.equal(response.status, 200);
    await response.json();
  }
  const limited = await request("entregador?rota=0");
  assert.equal(limited.status, 429);
  const body = await limited.json();
  assert.equal(body.success, false);
  assert.match(body.message, /requisições/i);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(token));
  const other = await request("entregador?rota=0", "Delivery " + "b".repeat(64));
  assert.equal(other.status, 200);
});

test("links inválidos variados continuam sujeitos ao limite por IP", async (t) => {
  const { request } = await trackingServer(t);
  for (let index = 0; index < 40; index++) {
    const response = await request("entregador?rota=0", "Delivery inválido-" + index);
    assert.equal(response.status, 401);
    await response.json();
  }
  const response = await request("entregador?rota=0", "Delivery inválido-novo");
  assert.equal(response.status, 429);
  assert.equal((await response.json()).success, false);
});
