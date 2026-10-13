"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { load } = require("./helpers");
const { signSession, createSessionMiddleware } = require("../services/sessionService");
const admin = require("../services/emailQueueAdminService");

const company = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const emailId = "44444444-4444-4444-8444-444444444444";
const secret = "synthetic-session-secret-no-production-access";
const request = (perfil = "ADMIN", empresaId = company) => ({
    user: { id: accountId, empresaId, perfil }, query: {}, ip: "127.0.0.1"
});
function row(extra = {}) {
    return { id: emailId, empresa_id: company, status: "FALHA", tentativas: 1,
        proxima_tentativa_em: "2026-10-01T12:00:00Z", criada_em: "2026-10-01T11:00:00Z",
        atualizada_em: "2026-10-01T11:01:00Z", expira_em: "2026-10-08T11:00:00Z",
        tratada_em: null, resultado_incerto: false, conteudo_disponivel: true, prazo_valido: true,
        erro_codigo: "EMAIL_REJECTED", dados: { to: "private@example.test", text: "private-content" },
        chave_idempotencia: "private-provider-key", provedor_id: "private-provider-id", ...extra };
}

test("admin de e-mails permite leitura a gerente e nega outros perfis sem consultar banco", async () => {
    let queries = 0;
    const db = { async query() { queries++; return { rows: [] }; } };
    await admin.list(db, request("GERENTE"));
    assert.equal(queries, 2);
    for (const req of [{}, request("CLIENTE"), request("ADMIN", "invalid")]) {
        await assert.rejects(admin.list(db, req), error => [401, 403].includes(error.status));
    }
    await assert.rejects(admin.act(db, request("GERENTE"), emailId, "encerrar"), { status: 403 });
    assert.equal(queries, 2);
});

test("listagem aplica empresa, filtro e paginação, resume pendências e omite dados pessoais", async () => {
    const calls = [];
    const db = { async query(sql, params) {
        calls.push({ sql, params });
        return { rows: sql.includes("GROUP BY") ? [
            { status: "FALHA", total: 3, sem_tratamento: 2 },
            { status: "INCERTA", total: 1, sem_tratamento: 1 },
            { status: "ENVIADA", total: 5, sem_tratamento: 5 }
        ] : [row({ erro_codigo: "private-provider-error" })] };
    }};
    const result = await admin.list(db, { ...request(), query: { status: "FALHA", page: "2", q: "4444", empresa_id: other } });
    assert.deepEqual(calls[0].params, [company, "FALHA", "%4444%", 25]);
    assert.deepEqual(calls[1].params, [company]);
    assert.equal(result.pendencias, 3);
    assert.equal(result.resumo.ENVIADA, 5);
    assert.equal(result.resumo.PROCESSANDO, 0);
    assert.equal(result.data[0].pode_reagendar, true);
    assert.equal(result.data[0].pode_encerrar, true);
    assert.doesNotMatch(JSON.stringify(result), /private|chave_idempotencia|dados|provedor_id|empresa_id/);
    await assert.rejects(admin.list(db, { ...request(), query: { status: "UNKNOWN" } }), { status: 400 });
    assert.equal(calls.length, 2);
});

test("admin nunca repete resultado incerto, prazo vencido, limite atingido ou conteúdo removido", async () => {
    for (const extra of [
        { status: "INCERTA" }, { resultado_incerto: true }, { prazo_valido: false },
        { tentativas: 8 }, { conteudo_disponivel: false }, { tratada_em: "2026-10-01T12:00:00Z" },
        { status: "ENVIADA" }, { status: "PROCESSANDO" }
    ]) {
        const calls = [];
        const client = { async query(sql, params) { calls.push({ sql, params }); return { rows: [row(extra)] }; } };
        await assert.rejects(admin.act({ transaction: fn => fn(client) }, request(), emailId, "reagendar"), { status: 409 });
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].params, [emailId, company]);
        assert.match(calls[0].sql, /FOR UPDATE/);
    }
});

test("reagendamento usa a transação da auditoria e não altera tentativas nem a primeira tentativa", async () => {
    const calls = [];
    const before = row();
    const after = row({ status: "PENDENTE" });
    const client = { async query(sql, params) {
        calls.push({ sql, params });
        return { rows: sql.includes("UPDATE fila_emails") ? [after] : [before] };
    }};
    const result = await admin.act({ transaction: fn => fn(client) }, request(), emailId, "reagendar");
    assert.equal(result.status, "PENDENTE");
    assert.equal(calls.length, 3);
    assert.doesNotMatch(calls[1].sql.split("WHERE")[0], /tentativas\s*=|primeira_tentativa_em\s*=|chave_idempotencia\s*=/);
    assert.match(calls[2].sql, /INSERT INTO auditoria_admin/);
    assert.deepEqual(calls[2].params.slice(0, 5), [company, accountId, "REAGENDAR_EMAIL", "fila_emails", emailId]);
    assert.doesNotMatch(JSON.stringify(calls[2].params), /private/);
});

test("cliques repetidos em reagendar ou encerrar não criam novo evento nem zeram a espera", async () => {
    for (const [action, before] of [
        ["reagendar", row({ status: "PENDENTE" })],
        ["encerrar", row({ status: "INCERTA", tratada_em: "2026-10-01T12:00:00Z" })]
    ]) {
        let calls = 0;
        const client = { async query() { calls++; return { rows: [before] }; } };
        const result = await admin.act({ transaction: fn => fn(client) }, request(), emailId, action);
        assert.equal(result.status, before.status);
        assert.equal(calls, 1);
    }
});

async function httpFixture(t) {
    const state = { perfil: "ADMIN", empresaId: company, queries: [], transactions: 0, fail: false };
    const db = { async query(sql, params) {
        state.queries.push({ sql, params });
        if (sql.includes("FROM usuarios")) return { rows: [{ id: accountId, empresa_id: state.empresaId, perfil: state.perfil, sessao_versao: 1 }] };
        if (state.fail) throw new Error("postgres://private-database-password/private-query");
        if (sql.includes("GROUP BY")) return { rows: [{ status: "FALHA", total: 1, sem_tratamento: 1 }] };
        if (sql.includes("FOR UPDATE")) return { rows: params[1] === company ? [row()] : [] };
        return { rows: params[0] === company ? [row()] : [] };
    }, async transaction(fn) { state.transactions++; return fn(db); } };
    const router = load("routes/professionalRoutes.js", {
        "../database/connection": db,
        "../middlewares/authMiddleware": createSessionMiddleware({ db, secret, type: "admin" }),
        "../services/adminUserService": {}, "../services/emailQueueService": {},
        "../services/emailQueueAdminService": admin
    });
    const app = express(); app.use(express.json()); app.use("/api", router);
    app.use(require("../middlewares/errorMiddleware"));
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return { state, async call(path = "/emails", { type = "admin", anonymous = false, method = "GET", body } = {}) {
        const token = signSession({ id: accountId, empresa_id: state.empresaId, perfil: state.perfil, sessao_versao: 1 }, type, secret);
        const response = await fetch("http://127.0.0.1:" + server.address().port + "/api" + path, {
            method, headers: { ...(anonymous ? {} : { Authorization: "Bearer " + token }), "Content-Type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        return { status: response.status, body: await response.json() };
    }};
}

test("rotas reais da fila recusam visitante e sessão de cliente antes de consultar dados", async t => {
    const { call, state } = await httpFixture(t);
    for (const options of [{ anonymous: true }, { type: "customer" }]) {
        assert.equal((await call("/emails", options)).status, 401);
        assert.equal((await call("/emails/" + emailId + "/reagendar", { ...options, method: "POST" })).status, 401);
    }
    assert.equal(state.queries.length, 0);
});

test("rotas permitem leitura ao gerente e reservam reagendar e encerrar ao administrador", async t => {
    const { call, state } = await httpFixture(t);
    state.perfil = "GERENTE";
    const response = await call();
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    for (const action of ["reagendar", "encerrar"]) assert.equal((await call("/emails/" + emailId + "/" + action, { method: "POST" })).status, 403);
    assert.equal(state.transactions, 0);
});

test("rotas não aceitam empresa do corpo/query e ocultam registros de outra empresa", async t => {
    t.mock.method(console, "error", () => {});
    const { call, state } = await httpFixture(t);
    const own = await call("/emails?empresa_id=" + other);
    assert.equal(own.body.data.length, 1);
    state.empresaId = other;
    const listing = await call("/emails?empresa_id=" + company);
    assert.equal(listing.status, 200);
    assert.equal(listing.body.data.length, 0);
    for (const action of ["reagendar", "encerrar"]) {
        const response = await call("/emails/" + emailId + "/" + action, { method: "POST", body: { empresa_id: company } });
        assert.equal(response.status, 404);
    }
    assert.ok(!state.queries.some(call => /UPDATE fila_emails|INSERT INTO auditoria_admin/.test(call.sql)));
});

test("rotas validam identificador e filtro, e ocultam erro interno de banco", async t => {
    const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
    const { call, state } = await httpFixture(t);
    assert.equal((await call("/emails/not-a-uuid/reagendar", { method: "POST" })).status, 400);
    assert.equal((await call("/emails?status=PRIVATE_PROVIDER_RESPONSE")).status, 400);
    assert.equal(state.transactions, 0);
    state.fail = true;
    const result = await call();
    assert.equal(result.status, 500);
    assert.doesNotMatch(JSON.stringify({ result, logs }), /postgres|private-database-password|private-query/);
});
