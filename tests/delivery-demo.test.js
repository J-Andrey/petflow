"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDemoJourney, mountDemo } = require("../public/js/pages/delivery-demo");

function demoPage({ reducedMotion = false } = {}) {
    const ids = ["demoStart", "demoPause", "demoReset", "demoStatus", "demoElapsed", "demoProgress", "demoProgressFill", "demoProgressLabel", "demoMapState", "demoRoutePath", "demoVehicle"];
    function node() {
        const listeners = {}, attributes = {}, classes = new Set();
        return {
            listeners, attributes, style: {}, dataset: {}, textContent: "", disabled: false,
            classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
            setAttribute(name, value) { attributes[name] = value; }, removeAttribute(name) { delete attributes[name]; },
            addEventListener(name, callback) { listeners[name] = callback; }
        };
    }
    const elements = Object.fromEntries(ids.map(id => [id, node()]));
    elements.demoRoutePath.getTotalLength = () => 100;
    elements.demoRoutePath.getPointAtLength = length => ({ x: length, y: length / 2 });
    const steps = ["received", "preparing", "en-route", "delivered"].map(stage => {
        const value = node(); value.dataset.demoStage = stage; return value;
    });
    const documentListeners = {}, windowListeners = {}, frames = new Map();
    let frameId = 0;
    const document = { hidden: false, getElementById: id => elements[id], querySelectorAll: () => steps, addEventListener(name, callback) { documentListeners[name] = callback; } };
    const window = {
        requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        matchMedia: () => ({ matches: reducedMotion }),
        addEventListener(name, callback) { windowListeners[name] = callback; }
    };
    for (const key of ["fetch", "navigator", "localStorage", "sessionStorage", "location"]) {
        Object.defineProperty(window, key, { get() { throw new Error("A demonstração não pode acessar " + key); } });
    }
    mountDemo(document, window);
    const click = id => elements[id].listeners.click();
    const frame = time => {
        const [id, callback] = frames.entries().next().value || [];
        assert.ok(callback, "Deve haver uma animação agendada.");
        frames.delete(id); callback(time);
    };
    return { elements, steps, document, documentListeners, windowListeners, frames, click, frame };
}

test("demo percorre recebido, preparação, rota e conclusão sem antecipar a posição", () => {
    const journey = createDemoJourney(1000);
    assert.equal(journey.snapshot().stage, "received");
    journey.start(); journey.advance(149);
    assert.equal(journey.snapshot().stage, "received");
    journey.advance(1);
    assert.equal(journey.snapshot().stage, "preparing");
    assert.equal(journey.snapshot().routeProgress, 0);
    journey.advance(150);
    assert.equal(journey.snapshot().stage, "en-route");
    assert.equal(journey.snapshot().routeProgress, 0);
    journey.advance(350);
    assert.ok(Math.abs(journey.snapshot().routeProgress - .5) < 1e-12);
    journey.advance(100000);
    assert.equal(journey.snapshot().stage, "delivered");
    assert.equal(journey.snapshot().elapsedMs, 1000);
    assert.equal(journey.snapshot().routeProgress, 1);
    assert.equal(journey.snapshot().running, false);
    assert.equal(journey.start().running, false, "Concluir não pode iniciar uma nova viagem sem reiniciar.");
});

test("pausa preserva tempo e reiniciar cria uma demonstração limpa, sem estado persistido", () => {
    const journey = createDemoJourney();
    journey.advance(30000);
    assert.equal(journey.snapshot().elapsedMs, 0, "O relógio não avança antes de iniciar.");
    journey.start(); journey.advance(30000); journey.pause(); journey.advance(200000);
    assert.equal(journey.snapshot().elapsedMs, 30000);
    journey.start(); journey.advance(1000);
    assert.equal(journey.snapshot().elapsedMs, 31000);
    const reset = journey.reset();
    assert.equal(reset.elapsedMs, 0); assert.equal(reset.started, false); assert.equal(reset.running, false); assert.equal(reset.stage, "received");
    journey.advance(90000);
    assert.equal(journey.snapshot().elapsedMs, 0);
    assert.equal(createDemoJourney().snapshot().elapsedMs, 0, "Uma nova instância começa vazia.");
});

test("relógio demonstrativo ignora tempos inválidos e limita a duração", () => {
    for (const duration of [0, -1, NaN, Infinity, "90000"]) assert.throws(() => createDemoJourney(duration), RangeError);
    const journey = createDemoJourney(1000); journey.start();
    for (const value of [NaN, Infinity, -500, undefined, "500"]) journey.advance(value);
    assert.equal(journey.snapshot().elapsedMs, 0);
    journey.advance(1500);
    assert.equal(journey.snapshot().progress, 1);
});

test("tela oculta cancela animação e o tempo fora da página não avança o exemplo", () => {
    const page = demoPage();
    page.click("demoStart"); page.click("demoStart");
    assert.equal(page.frames.size, 1, "Cliques repetidos não podem iniciar relógios paralelos.");
    page.frame(0); page.frame(30000);
    assert.equal(page.elements.demoElapsed.textContent, "0:30");
    assert.equal(page.steps[2].attributes["aria-current"], "step");
    page.document.hidden = true; page.documentListeners.visibilitychange();
    assert.equal(page.frames.size, 0);
    assert.equal(page.elements.demoPause.disabled, true);
    assert.match(page.elements.demoStatus.textContent, /pausada ao sair/);
    page.click("demoStart");
    assert.equal(page.frames.size, 0, "Não pode iniciar enquanto estiver oculta.");
    page.document.hidden = false; page.documentListeners.visibilitychange();
    assert.equal(page.frames.size, 0, "Voltar não retoma sozinho.");
    page.click("demoStart"); page.frame(1000000);
    assert.equal(page.elements.demoElapsed.textContent, "0:30");
    page.frame(1001000);
    assert.equal(page.elements.demoElapsed.textContent, "0:31");
    page.windowListeners.pagehide();
    assert.equal(page.frames.size, 0);
    page.click("demoReset");
    assert.equal(page.elements.demoProgress.attributes["aria-valuenow"], "0");
    assert.equal(page.elements.demoVehicle.attributes.transform, "translate(0 0)");
});

test("conclusão encerra animação e modo de movimento reduzido mantém marcador por etapas", () => {
    const page = demoPage({ reducedMotion: true });
    page.click("demoStart"); page.frame(0); page.frame(30000);
    assert.equal(page.elements.demoVehicle.attributes.transform, "translate(50 25)");
    page.frame(45000);
    assert.equal(page.elements.demoVehicle.attributes.transform, "translate(50 25)");
    page.frame(90000);
    assert.equal(page.elements.demoProgress.attributes["aria-valuenow"], "100");
    assert.equal(page.elements.demoVehicle.attributes.transform, "translate(100 50)");
    assert.equal(page.elements.demoStart.disabled, true);
    assert.equal(page.elements.demoPause.disabled, true);
    assert.equal(page.frames.size, 0);
    assert.equal(page.steps[3].attributes["aria-current"], "step");
    assert.match(page.elements.demoStatus.textContent, /demonstrativo concluído/);
    page.windowListeners.pagehide();
    assert.match(page.elements.demoStatus.textContent, /demonstrativo concluído/, "Sair após concluir não pode indicar uma viagem pausada.");
});

test("link externo da demo usa somente os dois pontos públicos fixos, sem localização automática", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/entrega-demo.html"), "utf8");
    const href = html.match(/href="(https:\/\/www\.google\.com\/maps\/dir\/\?[^\"]+)"/)[1].replace(/&amp;/g, "&");
    const link = new URL(href);
    assert.equal(link.searchParams.get("origin"), "51.513071,-0.158662");
    assert.equal(link.searchParams.get("destination"), "51.504753,-0.175007");
    assert.equal(link.searchParams.get("travelmode"), "driving");
    assert.equal(link.searchParams.has("dir_action"), false);
    assert.match(html, /Demonstração · rota simulada/);
    assert.match(html, /Sem pedido ou localização reais/);
    assert.doesNotMatch(html, /js\/pages\/tracking\.js|Nação Animal|api\/entregas/);
});
