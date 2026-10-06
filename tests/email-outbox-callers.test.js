"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load, response } = require("./helpers");

test("lembrete e outbox compartilham transação; fila indisponível reverte notificação", async () => {
    let committed = false, rolledBack = false;
    const item = { id: "appointment", cliente_id: "customer", cliente: "Cliente", email: "synthetic@example.test",
        pet: "Pet", servico: "Consulta", data: "2026-10-09", hora: "10:00" };
    const client = { async query() { return { rows: [{ id: "notification" }] }; } };
    const reminder = load("services/reminderService.js", {
        "../database/connection": {
            async query(sql) { return { rows: sql.includes("FROM agendamentos") ? [item] : [] }; },
            async transaction(fn) { try { const result = await fn(client); committed = true; return result; } catch (error) { rolledBack = true; throw error; } }
        },
        "./emailService": {
            appointmentReminderTemplate() { return { subject: "Lembrete", text: "Conteúdo sintético" }; },
            async enqueueEmail(options, transactionClient) {
                assert.equal(transactionClient, client);
                assert.equal(committed, false);
                assert.equal(options.idempotencyKey, "lembrete-notification");
                throw new Error("outbox unavailable");
            }
        }
    });
    await assert.rejects(reminder.runDailyReminders(), /outbox unavailable/);
    assert.equal(committed, false);
    assert.equal(rolledBack, true);
});

function newsletterFixture({ active = false, failQueue = false } = {}) {
    const state = { committed: false, rolledBack: false, emails: 0 };
    const client = { async query(sql) {
        if(sql.includes("SELECT id,status")) return { rows: active ? [{ id: "subscription", status: "ATIVO" }] : [] };
        if(sql.includes("RETURNING")) return { rows: [{ id: "subscription", nome: "Cliente", email: "synthetic@example.test", status: "ATIVO" }] };
        return { rows: [] };
    }};
    const controller = load("controllers/newsletterController.js", {
        "../config/env": { JWT_SECRET: "test-only-secret" },
        "../database/connection": {
            async query() { return { rows: [{ id: "company" }] }; },
            async transaction(fn) { try { const result = await fn(client); state.committed = true; return result; } catch(error) { state.rolledBack = true; throw error; } }
        },
        "../services/emailService": {
            newsletterConfirmationTemplate() { return { subject: "Newsletter", text: "Conteúdo sintético" }; },
            async enqueueEmail(options, transactionClient) {
                assert.equal(transactionClient, client);
                assert.equal(state.committed, false);
                assert.match(options.idempotencyKey, /^newsletter-confirmada-subscription-/);
                state.emails++;
                if(failQueue) throw new Error("outbox unavailable");
            }
        }
    });
    return { controller, state };
}

test("newsletter persiste confirmação antes do commit e não repete assinatura ativa", async () => {
    for (const active of [false, true]) {
        const { controller, state } = newsletterFixture({ active });
        const res = response();
        await controller.subscribe({ body: { nome: "Cliente", email: "synthetic@example.test", consentimento: true } }, res, error => { throw error; });
        assert.equal(res.body.success, true);
        assert.equal(state.committed, true);
        assert.equal(state.emails, active ? 0 : 1);
    }
});

test("newsletter não confirma inscrição se o outbox não puder persistir", async () => {
    const { controller, state } = newsletterFixture({ failQueue: true });
    const res = response(); let failure;
    await controller.subscribe({ body: { nome: "Cliente", email: "synthetic@example.test", consentimento: true } }, res, error => { failure = error; });
    assert.match(failure.message, /outbox unavailable/);
    assert.equal(res.body, undefined);
    assert.equal(state.rolledBack, true);
    assert.equal(state.committed, false);
});

test("mudança de status persiste outbox antes do commit e falha de fila reverte alteração", async () => {
    let committed = false, rolledBack = false;
    const current = { id: "sale", empresa_id: "company", cliente_id: "customer", status: "EM_SEPARACAO" };
    const client = { async query(sql) {
        return { rows: sql.includes("FROM vendas") ? [current] : sql.includes("FROM clientes") ? [{ nome: "Cliente", email: "synthetic@example.test" }] : [] };
    }};
    const service = load("services/vendaService.js", {
        "../database/connection": { async transaction(fn) { try { const result = await fn(client); committed = true; return result; } catch(error) { rolledBack = true; throw error; } } },
        "../config/env": { JWT_SECRET: "test-only" },
        "./deliveryService": { createDeliveryService() { return {}; } }, "./couponService": {}, "./reservationService": {},
        "../models/vendaModel": { async atualizarStatus() { return { ...current, status: "SAIU_PARA_ENTREGA" }; } },
        "../models/itemVendaModel": {}, "./movimentacaoEstoqueService": {}, "./financeiroService": {},
        "./emailService": {
            orderOutForDeliveryTemplate() { return { subject: "Pedido", text: "Conteúdo sintético" }; },
            async enqueueEmail(options, transactionClient) {
                assert.equal(transactionClient, client);
                assert.equal(committed, false);
                assert.equal(options.idempotencyKey, "pedido-status-sale-SAIU_PARA_ENTREGA");
                throw new Error("outbox unavailable");
            }
        }
    });
    await assert.rejects(service.atualizarStatusPedido("company", "sale", "SAIU_PARA_ENTREGA"), /outbox unavailable/);
    assert.equal(committed, false);
    assert.equal(rolledBack, true);
});
