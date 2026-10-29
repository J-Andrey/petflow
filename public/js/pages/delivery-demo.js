"use strict";

// Página isolada de demonstração: estado apenas em memória, sem pedidos ou GPS.
(function deliveryDemo() {
    const STAGES = ["received", "preparing", "en-route", "delivered"];

    function createDemoJourney(durationMs = 90000) {
        if (!Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError("Duração da demonstração inválida.");
        let elapsedMs = 0, running = false, started = false;
        function snapshot() {
            const progress = elapsedMs / durationMs;
            const stage = progress >= 1 ? "delivered" : progress >= .30 ? "en-route" : progress >= .15 ? "preparing" : "received";
            return Object.freeze({ elapsedMs, durationMs, progress, stage, running, started, routeProgress: Math.min(1, Math.max(0, (progress - .30) / .70)) });
        }
        return {
            snapshot,
            start() { if (elapsedMs < durationMs) { running = true; started = true; } return snapshot(); },
            pause() { running = false; return snapshot(); },
            reset() { elapsedMs = 0; running = false; started = false; return snapshot(); },
            advance(deltaMs) {
                if (running && Number.isFinite(deltaMs) && deltaMs > 0) {
                    elapsedMs = Math.min(durationMs, elapsedMs + deltaMs);
                    if (elapsedMs >= durationMs) running = false;
                }
                return snapshot();
            }
        };
    }

    function mountDemo(document, window) {
        const ids = ["demoStart", "demoPause", "demoReset", "demoStatus", "demoElapsed", "demoProgress", "demoProgressFill", "demoProgressLabel", "demoMapState", "demoRoutePath", "demoVehicle"];
        const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
        if (Object.values(elements).some(value => !value)) return;
        const steps = [...document.querySelectorAll("[data-demo-stage]")];
        const journey = createDemoJourney();
        let frame = null, previousTime = null, lastStatus = "";
        const stageMessages = {
            received: "Pedido de exemplo recebido. A demonstração começou.",
            preparing: "Preparando a entrega de exemplo. Tudo é simulado nesta página.",
            "en-route": "Entrega de exemplo em rota. Acompanhe o marcador simulado.",
            delivered: "Percurso demonstrativo concluído. Você pode reiniciar o exemplo."
        };
        const motionReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
        function render(message) {
            const state = journey.snapshot();
            const percentage = Math.floor(state.progress * 100);
            const seconds = Math.floor(state.elapsedMs / 1000);
            elements.demoElapsed.textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
            elements.demoProgressLabel.textContent = percentage + "%";
            elements.demoProgress.setAttribute("aria-valuenow", String(percentage));
            elements.demoProgressFill.style.width = percentage + "%";
            elements.demoStart.disabled = state.running || state.stage === "delivered";
            elements.demoStart.textContent = state.started && state.stage !== "delivered" ? "Retomar demonstração" : state.stage === "delivered" ? "Exemplo concluído" : "Iniciar demonstração →";
            elements.demoPause.disabled = !state.running;
            elements.demoMapState.textContent = state.stage === "delivered" ? "Exemplo concluído" : state.running ? "Simulação em andamento" : state.started ? "Simulação pausada" : "Pronto para começar";
            elements.demoMapState.dataset.running = String(state.running);
            for (const step of steps) {
                const index = STAGES.indexOf(step.dataset.demoStage);
                const current = STAGES.indexOf(state.stage);
                if (index === current) step.setAttribute("aria-current", "step");
                else step.removeAttribute("aria-current");
                step.classList.toggle("is-complete", index < current);
            }
            const status = message || (!state.started ? "Tudo pronto para conhecer o percurso." : !state.running && state.stage !== "delivered" ? "Demonstração pausada. Retome quando quiser." : stageMessages[state.stage]);
            if (status !== lastStatus) { elements.demoStatus.textContent = status; lastStatus = status; }
            try {
                // Com movimento reduzido, o marcador muda apenas nas etapas da entrega.
                const progress = motionReduced ? state.stage === "delivered" ? 1 : state.stage === "en-route" ? .5 : 0 : state.routeProgress;
                const point = elements.demoRoutePath.getPointAtLength(elements.demoRoutePath.getTotalLength() * progress);
                elements.demoVehicle.setAttribute("transform", `translate(${point.x} ${point.y})`);
            } catch { /* O resumo continua disponível caso o navegador não calcule o SVG. */ }
        }
        function cancelFrame() {
            if (frame !== null) window.cancelAnimationFrame(frame);
            frame = null;
            previousTime = null;
        }
        function pause(message) {
            journey.pause();
            cancelFrame();
            render(message);
        }
        function tick(time) {
            frame = null;
            if (document.hidden) { pause("Demonstração pausada ao sair da página. Retome quando quiser."); return; }
            const delta = previousTime === null ? 0 : Math.max(0, time - previousTime);
            previousTime = time;
            journey.advance(delta);
            render();
            if (journey.snapshot().running) frame = window.requestAnimationFrame(tick);
            else previousTime = null;
        }
        elements.demoStart.addEventListener("click", () => {
            if (document.hidden || journey.snapshot().running || journey.snapshot().stage === "delivered") return;
            journey.start();
            previousTime = null;
            render();
            frame = window.requestAnimationFrame(tick);
        });
        elements.demoPause.addEventListener("click", () => pause());
        elements.demoReset.addEventListener("click", () => { cancelFrame(); journey.reset(); render(); });
        document.addEventListener("visibilitychange", () => {
            if (document.hidden && journey.snapshot().running) pause("Demonstração pausada ao sair da página. Retome quando quiser.");
        });
        window.addEventListener("pagehide", () => {
            if (journey.snapshot().running) pause("Demonstração pausada ao sair da página. Retome quando quiser.");
            else cancelFrame();
        });
        render();
    }

    if (typeof module === "object" && module.exports) module.exports = { createDemoJourney, mountDemo };
    else if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mountDemo(document, window), { once: true });
        else mountDemo(document, window);
    }
})();
