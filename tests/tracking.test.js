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
  mapReady = false,
  routeDrawError = false,
  iconControls = false,
  speech = false,
  onScript,
  hash = "#" + token,
  savedState = null,
  search = "",
  onRequest,
  initialData = null,
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
      "speed",
      "distance",
      "duration",
      "arrival",
      "nextInstruction",
      "maneuverIcon",
      "nextManeuverIcon",
    ].map((id) => [id, { hidden: false, textContent: "" }]),
  );
  if (iconControls)
    for (const id of ["navigation", "voice"]) {
      const label = { textContent: "" };
      nodes[id].innerHTML = "<svg></svg><span class='sr-only'></span>";
      nodes[id].label = label;
      nodes[id].querySelector = () => label;
      nodes[id].attributes = {};
      nodes[id].setAttribute = (name, value) => {
        nodes[id].attributes[name] = value;
      };
    }
  const requests = [],
    timers = [],
    timeouts = [],
    scripts = [],
    speechCalls = [],
    events = {},
    geo = { watched: 0, refreshed: 0, cleared: [] },
    mapCalls = { pans: [], bounds: [], lines: [], markers: [], events: {} };
  let now = 1800000000000,
    shared = null,
    rejectPosition = false,
    serverData = initialData;
  const document = {
    hidden: false,
    getElementById: (id) => nodes[id],
    addEventListener: (name, fn) => {
      events[name] = fn;
    },
    createElement: () => ({}),
    head: {
      append: (script) => { scripts.push(script); if (onScript) onScript(script, { events, document }); else if (mapFailure) script.onerror(); else script.onload(); },
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
  const speechApi = { cancel() {}, speak: (utterance) => speechCalls.push(utterance) };
  const context = vm.createContext({
    URLSearchParams,
    Date: ClockDate,
    AbortController,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: speechApi,
    window: {
      speechSynthesis: speech ? speechApi : undefined,
      isSecureContext: secure,
      addEventListener: (name, fn) => {
        events[name] = fn;
      },
    },
    document,
    history,
    location: { hash, search, pathname: "/entrega.html" },
    google: {
      maps: {
        Map: class {
          constructor(node, options) {
            mapCalls.options = options;
          }
          panTo(point) {
            mapCalls.pans.push(point);
          }
          fitBounds(bounds, padding) {
            mapCalls.bounds.push({ bounds, padding });
          }
          addListener(name, fn) {
            mapCalls.events[name] = fn;
          }
        },
        Marker: class {
          constructor(options) {
            if (brokenMap) throw new Error("Falha do marcador");
            mapCalls.markers.push(options);
          }
          setPosition() {}
          setIcon(icon) {
            mapCalls.icon = icon;
          }
        },
        Polyline: class {
          constructor(options) {
            mapCalls.lines.push(options);
          }
          setPath() {}
          setMap() {}
        },
        LatLngBounds: class {
          extend() {}
        },
        SymbolPath: { FORWARD_CLOSED_ARROW: "arrow", CIRCLE: "circle" },
        geometry: {
          encoding: {
            decodePath() {
              if (routeDrawError) throw new Error("Rota inválida");
              return [
                { lat: -23.5, lng: -46.6 },
                { lat: -23.6, lng: -46.7 },
              ];
            },
          },
        },
      },
    },
    sessionStorage: { getItem: () => null },
    navigator: {
      onLine: true,
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
    clearInterval: (id) => {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    setTimeout: (fn, ms) => {
      timeouts.push({ fn, ms });
      return timeouts.length;
    },
    clearTimeout(id) {
      if (timeouts[id - 1]) timeouts[id - 1].cleared = true;
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const handled = onRequest?.(url, options);
      if (handled !== undefined) return handled;
      if (url.endsWith("/config"))
        return {
          ok: true,
          json: async () => ({
            key:
              mapFailure || brokenMap || mapReady ? "test-browser-key" : null,
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
            ...(serverData || shared || {}),
            antiga: serverData ? serverData.antiga : !shared,
            atualizado_em: serverData
              ? serverData.atualizado_em
              : shared
                ? new Date(shared.observado_em).toISOString()
                : null,
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
    mapCalls,
    scripts,
    speechCalls,
    timers,
    timeouts,
    navigator: context.navigator,
    serverData: (value) => {
      serverData = value;
    },
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
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message }),
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
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
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
  const other = await request(
    "entregador?rota=0",
    "Delivery " + "b".repeat(64),
  );
  assert.equal(other.status, 200);
});

test("links inválidos variados continuam sujeitos ao limite por IP", async (t) => {
  const { request } = await trackingServer(t);
  for (let index = 0; index < 40; index++) {
    const response = await request(
      "entregador?rota=0",
      "Delivery inválido-" + index,
    );
    assert.equal(response.status, 401);
    await response.json();
  }
  const response = await request("entregador?rota=0", "Delivery inválido-novo");
  assert.equal(response.status, 429);
  assert.equal((await response.json()).success, false);
});

test("pagehide pausa GPS e pageshow retoma sem aceitar callbacks da sessão anterior", async () => {
  const driver = await page();
  driver.nodes.start.onclick();
  const oldWatch = driver.geo.success;
  driver.tick(15000);
  driver.timers.find((timer) => timer.fn.name === "refreshPosition").fn();
  const oldCurrent = driver.geo.current;
  assert.equal(typeof driver.events.pagehide, "function");
  driver.events.pagehide({ persisted: true });
  assert.deepEqual(driver.geo.cleared, [17]);
  assert.ok(driver.timers.every((timer) => timer.cleared));
  driver.events.pageshow({ persisted: true });
  assert.equal(driver.geo.watched, 2);
  const obsolete = {
    coords: { latitude: -23.5, longitude: -46.6, accuracy: 10 },
    timestamp: driver.now(),
  };
  oldWatch(obsolete);
  oldCurrent(obsolete);
  await settle();
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    0,
  );
  driver.fix();
  await settle();
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    1,
  );
  driver.tick(15000);
  driver.timers
    .filter((timer) => !timer.cleared && timer.fn.name === "refreshPosition")[0]
    .fn();
  assert.equal(driver.geo.refreshed, 2);
});

test("callback GPS antigo e erro de permissão pendente não interferem na retomada", async () => {
  const driver = await page();
  driver.nodes.start.onclick();
  driver.tick(15000);
  driver.timers.find((timer) => timer.fn.name === "refreshPosition").fn();
  const oldWatch = driver.geo.success,
    oldError = driver.geo.currentError;
  driver.document.hidden = true;
  driver.events.visibilitychange();
  driver.document.hidden = false;
  driver.events.visibilitychange();
  oldError({ code: 1 });
  oldWatch({
    coords: { latitude: -23.5, longitude: -46.6, accuracy: 10 },
    timestamp: driver.now(),
  });
  await settle();
  assert.equal(driver.nodes.start.hidden, true);
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    0,
  );
  driver.fix();
  await settle();
  assert.match(driver.nodes.gpsStatus.textContent, /GPS compartilhado/);
});

test("POST de posição com link revogado encerra captura e oferece novo link", async () => {
  const driver = await page({
    onRequest: (url, options) =>
      options.method === "POST"
        ? {
            ok: false,
            status: 401,
            json: async () => ({ message: "Link expirado ou revogado." }),
          }
        : undefined,
  });
  driver.nodes.start.onclick();
  driver.fix();
  await settle();
  assert.deepEqual(driver.geo.cleared, [17]);
  assert.equal(driver.nodes.start.disabled, true);
  assert.match(driver.nodes.status.textContent, /expirado ou revogado/);
  const total = driver.requests.length;
  driver.tick(5000);
  for (const timer of driver.timers) await timer.fn();
  assert.equal(driver.requests.length, total);
});

test("consulta pendente não substitui o encerramento confirmado", async () => {
  let resolvePoll,
    hold = false;
  const driver = await page({
    onRequest: (url, options) =>
      hold && options.method === "GET" && !url.endsWith("config")
        ? new Promise((resolve) => {
            resolvePoll = resolve;
          })
        : undefined,
  });
  driver.nodes.start.onclick();
  hold = true;
  const pending = driver.timers.find((timer) => timer.fn.name === "poll").fn();
  await settle();
  await driver.nodes.stop.onclick();
  resolvePoll({
    ok: true,
    json: async () => ({
      data: {
        antiga: false,
        atualizado_em: new Date(driver.now()).toISOString(),
      },
    }),
  });
  await pending;
  assert.match(driver.nodes.status.textContent, /Compartilhamento encerrado/);
});

test("cliente e admin mostram posição antiga sem previsão de chegada durante desconexão", async () => {
  for (const search of ["?pedido=pedido", "?admin=1&pedido=pedido"]) {
    const viewer = await page({
      search,
      initialData: {
        latitude: -23.5,
        longitude: -46.6,
        antiga: false,
        atualizado_em: new Date(1800000000000).toISOString(),
        rota: { distanceMeters: 3000, duration: "600s" },
      },
    });
    assert.match(viewer.nodes.metrics.textContent, /Chegada/);
    viewer.tick(35000);
    viewer.navigator.onLine = false;
    assert.equal(typeof viewer.events.offline, "function");
    viewer.events.offline();
    assert.match(viewer.nodes.status.textContent, /Sem conexão/);
    assert.match(viewer.nodes.status.textContent, /antiga/);
    assert.doesNotMatch(viewer.nodes.metrics.textContent, /Chegada/);
    const count = viewer.requests.length;
    await viewer.timers.find((timer) => timer.fn.name === "poll").fn();
    assert.equal(viewer.requests.length, count);
    viewer.serverData({
      latitude: -23.6,
      longitude: -46.7,
      antiga: false,
      atualizado_em: new Date(viewer.now()).toISOString(),
    });
    viewer.navigator.onLine = true;
    viewer.events.online();
    await settle();
    assert.match(viewer.nodes.status.textContent, /a caminho/);
  }
});

test("entregador reconecta com observação nova sem reenviar captura anterior", async () => {
  const driver = await page();
  driver.nodes.start.onclick();
  driver.navigator.onLine = false;
  assert.equal(typeof driver.events.offline, "function");
  driver.events.offline();
  driver.fix();
  await settle();
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    0,
  );
  driver.navigator.onLine = true;
  driver.events.online();
  await settle();
  assert.equal(driver.geo.watched, 2);
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    0,
  );
  driver.tick(5000);
  driver.fix();
  await settle();
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    1,
  );
});

test("consulta sem resposta expira e a próxima consulta pode retomar", async () => {
  let hang = false;
  const driver = await page({
    onRequest: (url, options) =>
      hang && options.method === "GET" && !url.endsWith("config")
        ? new Promise((resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () =>
                reject(
                  Object.assign(new Error("Abortado"), { name: "AbortError" }),
                ),
              { once: true },
            );
          })
        : undefined,
  });
  hang = true;
  const pending = driver.timers.find((timer) => timer.fn.name === "poll").fn();
  await settle();
  const timeout = driver.timeouts.find(
    (timer) => !timer.cleared && timer.ms === 15000,
  );
  assert.ok(timeout, "requisição precisa de timeout");
  timeout.fn();
  await pending;
  assert.match(driver.nodes.status.textContent, /demorou/);
  hang = false;
  const count = driver.requests.length;
  await driver.timers.find((timer) => timer.fn.name === "poll").fn();
  assert.equal(driver.requests.length, count + 1);
});

test("captura com horário ausente ou coordenadas inválidas não é enviada", async () => {
  const driver = await page();
  driver.nodes.start.onclick();
  driver.geo.success({
    coords: { latitude: -23.5, longitude: -46.6, accuracy: 10 },
  });
  await settle();
  driver.geo.success({
    coords: { latitude: 200, longitude: -46.6, accuracy: 10 },
    timestamp: driver.now(),
  });
  await settle();
  assert.equal(
    driver.requests.filter((request) => request.options.method === "POST")
      .length,
    0,
  );
  assert.match(driver.nodes.gpsStatus.textContent, /impreciso|inválido/);
});

test("painel de navegação usa apenas métricas e manobras recebidas e não desloca ETA a cada poll", async () => {
  const stamp = new Date(1800000000000).toISOString();
  const data = {
    latitude: -23.5,
    longitude: -46.6,
    velocidade: 10,
    antiga: false,
    atualizado_em: stamp,
    rota: {
      distanceMeters: 900,
      duration: "600s",
      origem_gps_observado_em: stamp,
      legs: [
        {
          steps: [
            {
              navigationInstruction: {
                instructions: "Vire à esquerda na Rua A",
                maneuver: "TURN_LEFT",
              },
            },
            {
              navigationInstruction: {
                instructions: "Siga em frente na Rua B",
                maneuver: "STRAIGHT",
              },
            },
          ],
        },
      ],
    },
  };
  const viewer = await page({ search: "?pedido=pedido", initialData: data });
  assert.equal(viewer.nodes.distance.textContent, "900 m");
  assert.equal(viewer.nodes.duration.textContent, "10 min");
  assert.equal(viewer.nodes.speed.textContent, "36");
  assert.equal(
    viewer.nodes.instruction.textContent,
    "Vire à esquerda na Rua A",
  );
  assert.equal(
    viewer.nodes.nextInstruction.textContent,
    "Siga em frente na Rua B",
  );
  assert.match(viewer.nodes.maneuverIcon.innerHTML, /scale\(-1 1\)/);
  assert.doesNotMatch(viewer.nodes.nextManeuverIcon.innerHTML, /scale\(-1 1\)/);
  const eta = viewer.nodes.arrival.textContent;
  viewer.tick(20000);
  await viewer.timers.find((timer) => timer.fn.name === "poll").fn();
  assert.equal(viewer.nodes.arrival.textContent, eta);
  viewer.serverData({
    ...data,
    rota: {
      distanceMeters: 1200,
      duration: "120s",
      origem_gps_observado_em: stamp,
    },
  });
  await viewer.timers.find((timer) => timer.fn.name === "poll").fn();
  assert.equal(viewer.nodes.distance.textContent, "1,2 km");
  assert.equal(viewer.nodes.nextInstruction.textContent, "—");
  viewer.tick(15000);
  await viewer.timers.find((timer) => timer.fn.name === "poll").fn();
  assert.equal(viewer.nodes.duration.textContent, "—");
  assert.equal(viewer.nodes.arrival.textContent, "—");
  assert.equal(viewer.nodes.speed.textContent, "—");
});

test("falha ao revogar pausa GPS e permite retomar ou tentar encerrar novamente", async () => {
  let deny = true;
  const driver = await page({
    initialData: {
      antiga: false,
      atualizado_em: new Date(1800000000000).toISOString(),
    },
    onRequest: (url, options) =>
      deny && options.method === "DELETE"
        ? {
            ok: false,
            status: 503,
            json: async () => ({ message: "Servidor indisponível" }),
          }
        : undefined,
  });
  driver.nodes.start.onclick();
  await driver.nodes.stop.onclick();
  assert.equal(driver.nodes.start.hidden, false);
  assert.equal(driver.nodes.stop.disabled, false);
  assert.match(driver.nodes.status.textContent, /GPS pausado/);
  assert.match(driver.nodes.gpsStatus.textContent, /Não foi possível revogar/);
  driver.nodes.start.onclick();
  assert.equal(driver.geo.watched, 2);
  deny = false;
  await driver.nodes.stop.onclick();
  assert.match(driver.nodes.status.textContent, /Compartilhamento encerrado/);
});

test("posição recusada por ser anterior à salva não informa compartilhamento confirmado", async () => {
  const driver = await page({
    onRequest: (url, options) =>
      options.method === "POST"
        ? { ok: true, json: async () => ({ data: { atualizada: false } }) }
        : undefined,
  });
  driver.nodes.start.onclick();
  driver.fix();
  await settle();
  assert.doesNotMatch(driver.nodes.gpsStatus.textContent, /GPS compartilhado/);
  assert.match(driver.nodes.gpsStatus.textContent, /leitura mais recente/);
  assert.equal(driver.geo.refreshed, 1);
});

test("poll da sessão anterior não substitui uma posição nova ao retornar", async () => {
  let resolveOld,
    hold = false;
  const fresh = {
    antiga: false,
    atualizado_em: new Date(1800000000000).toISOString(),
    latitude: -23.6,
    longitude: -46.7,
  };
  const viewer = await page({
    search: "?pedido=pedido",
    initialData: fresh,
    onRequest: (url, options) =>
      hold && options.method === "GET" && !url.endsWith("config")
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : undefined,
  });
  hold = true;
  const pending = viewer.timers.find((timer) => timer.fn.name === "poll").fn();
  await settle();
  viewer.events.pagehide({ persisted: true });
  hold = false;
  viewer.events.pageshow({ persisted: true });
  await settle();
  resolveOld({
    ok: true,
    json: async () => ({ data: { antiga: true, atualizado_em: null } }),
  });
  await pending;
  assert.match(viewer.nodes.status.textContent, /a caminho/);
  assert.match(
    viewer.nodes.updated.textContent,
    /Última posição compartilhada/,
  );
});

test("timeout do envio libera tentativa posterior com nova posição", async () => {
  let hang = true;
  const driver = await page({
    onRequest: (url, options) =>
      hang && options.method === "POST"
        ? new Promise((resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () =>
                reject(
                  Object.assign(new Error("Abortado"), { name: "AbortError" }),
                ),
              { once: true },
            );
          })
        : undefined,
  });
  driver.nodes.start.onclick();
  driver.fix();
  await settle();
  driver.timeouts.find((timer) => !timer.cleared && timer.ms === 15000).fn();
  await settle();
  assert.match(driver.nodes.gpsStatus.textContent, /demorou/);
  hang = false;
  driver.tick(5000);
  driver.fix();
  await settle();
  assert.match(driver.nodes.gpsStatus.textContent, /GPS compartilhado/);
});

test("rota sem duração não cria previsão fictícia de chegada", async () => {
  const viewer = await page({
    search: "?pedido=pedido",
    initialData: {
      latitude: -23.5,
      longitude: -46.6,
      antiga: false,
      atualizado_em: new Date(1800000000000).toISOString(),
      rota: { distanceMeters: 1000 },
    },
  });
  assert.equal(viewer.nodes.arrival.textContent, "—");
  assert.equal(viewer.nodes.duration.textContent, "—");
  assert.doesNotMatch(viewer.nodes.metrics.textContent, /Chegada/);
});

test("mapa segue GPS real; rota completa suspende acompanhamento até centralizar", async () => {
  const driver = await page({
    mapReady: true,
    initialData: {
      latitude: -23.5,
      longitude: -46.6,
      antiga: false,
      atualizado_em: new Date(1800000000000).toISOString(),
      rota: {
        distanceMeters: 1200,
        duration: "120s",
        polyline: { encodedPolyline: "rota-teste" },
      },
    },
  });
  assert.equal(driver.mapCalls.options.styles[0].stylers[0].color, "#18334e");
  assert.ok(
    driver.mapCalls.lines.some(
      (line) => line.strokeColor === "#17dcf3" && line.strokeWeight === 8,
    ),
  );
  driver.nodes.start.onclick();
  driver.fix();
  await settle();
  driver.nodes.route.onclick();
  const pans = driver.mapCalls.pans.length;
  driver.tick(5000);
  driver.fix();
  await settle();
  assert.equal(driver.mapCalls.pans.length, pans);
  assert.ok(driver.mapCalls.bounds.at(-1).padding.top > 0);
  driver.nodes.center.onclick();
  assert.ok(driver.mapCalls.pans.length > pans);
  const centered = driver.mapCalls.pans.length;
  driver.tick(5000);
  driver.fix();
  await settle();
  assert.ok(driver.mapCalls.pans.length > centered);
  assert.equal(driver.mapCalls.icon.fillColor, "#3e86ff");
});

test("falha ao desenhar a rota preserva envio do GPS e oferece navegação externa", async () => {
  const driver = await page({
    mapReady: true,
    routeDrawError: true,
    initialData: {
      latitude: -23.5,
      longitude: -46.6,
      antiga: false,
      atualizado_em: new Date(1800000000000).toISOString(),
      rota: {
        distanceMeters: 1200,
        duration: "120s",
        polyline: { encodedPolyline: "rota-teste" },
      },
    },
  });
  assert.match(
    driver.nodes.mapStatus.textContent,
    /não conseguiu exibir a rota/,
  );
  driver.nodes.start.onclick();
  driver.fix();
  await settle();
  assert.match(driver.nodes.gpsStatus.textContent, /GPS compartilhado/);
  assert.equal(driver.nodes.navigation.hidden, false);
});

test("controles de voz e navegação preservam SVG e descrevem posição antiga", async () => {
  const viewer = await page({
    iconControls: true,
    search: "?pedido=pedido",
    initialData: {
      latitude: -23.5,
      longitude: -46.6,
      antiga: false,
      atualizado_em: new Date(1800000000000).toISOString(),
    },
  });
  assert.match(viewer.nodes.navigation.innerHTML, /<svg>/);
  assert.match(viewer.nodes.navigation.label.textContent, /Ver posição/);
  viewer.tick(35000);
  await viewer.timers.find((timer) => timer.fn.name === "poll").fn();
  assert.match(viewer.nodes.navigation.label.textContent, /última posição/);
  assert.match(
    viewer.nodes.navigation.attributes["aria-label"],
    /última posição/,
  );
  const driver = await page({ iconControls: true });
  driver.nodes.voice.onclick();
  assert.equal(driver.nodes.voice.attributes["aria-pressed"], "true");
  assert.equal(driver.nodes.voice.label.textContent, "Desativar voz");
  assert.match(driver.nodes.voice.innerHTML, /<svg>/);
});

test("marcador só indica direção quando o aparelho fornece heading real", async () => {
  const driver = await page({ mapReady: true });
  driver.nodes.start.onclick();
  driver.fix();
  await settle();
  assert.equal(driver.mapCalls.icon.path, "circle");
  driver.tick(5000);
  driver.geo.success({
    coords: { latitude: -23.5, longitude: -46.6, accuracy: 10, heading: 90 },
    timestamp: driver.now(),
  });
  await settle();
  assert.equal(driver.mapCalls.icon.path, "arrow");
  assert.equal(driver.mapCalls.icon.rotation, 90);
});


test("ativar voz anuncia a manobra atual uma vez e só repete após mudança", async () => {
  const data = { latitude: -23.5, longitude: -46.6, antiga: false, atualizado_em: new Date(1800000000000).toISOString(), rota: { distanceMeters: 1000, duration: "600s", legs: [{ steps: [{ navigationInstruction: { instructions: "Vire à direita na Rua A", maneuver: "TURN_RIGHT" } }] }] } };
  const driver = await page({ speech: true, iconControls: true, initialData: data });
  assert.equal(driver.speechCalls.length, 0);
  driver.nodes.voice.onclick();
  assert.equal(driver.speechCalls.length, 1);
  assert.equal(driver.speechCalls[0].text, "Vire à direita na Rua A");
  assert.equal(driver.speechCalls[0].lang, "pt-BR");
  assert.equal(driver.nodes.voice.attributes["aria-pressed"], "true");
  assert.match(driver.nodes.voice.innerHTML, /<svg>/);
  await driver.timers.find((timer) => timer.fn.name === "poll").fn();
  assert.equal(driver.speechCalls.length, 1);
  driver.serverData({ ...data, rota: { ...data.rota, legs: [{ steps: [{ navigationInstruction: { instructions: "Siga em frente na Rua B", maneuver: "STRAIGHT" } }] }] } });
  await driver.timers.find((timer) => timer.fn.name === "poll").fn();
  assert.equal(driver.speechCalls.length, 2);
  assert.equal(driver.speechCalls[1].text, "Siga em frente na Rua B");
});

test("ativação de voz não anuncia posição antiga ou sem conexão", async () => {
  const data = { latitude: -23.5, longitude: -46.6, antiga: false, atualizado_em: new Date(1800000000000).toISOString(), rota: { distanceMeters: 1000, duration: "600s", legs: [{ steps: [{ navigationInstruction: { instructions: "Vire à direita na Rua A" } }] }] } };
  for (const offline of [false, true]) {
    const driver = await page({ speech: true, initialData: data });
    if (offline) driver.navigator.onLine = false; else driver.tick(35000);
    driver.nodes.voice.onclick();
    assert.equal(driver.speechCalls.length, 0);
  }
});

test("retomar página durante carregamento do Maps não adiciona segundo SDK", async () => {
  let first = true;
  const driver = await page({ mapReady: true, onScript: (script, { events, document }) => {
    if (first) {
      first = false;
      document.hidden = true;
      events.visibilitychange();
      document.hidden = false;
      events.visibilitychange();
      setImmediate(() => script.onload());
    } else script.onload();
  } });
  await settle();
  assert.equal(driver.scripts.length, 1);
  assert.ok(driver.mapCalls.options);
});
