"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers");

const env = { RESEND_API_KEY: "test-only-key", EMAIL_FROM: "PetFlow <sender@example.test>", APP_URL: "https://example.test" };
const message = { to: "customer@example.test", subject: "Pedido", text: "Dados privados do pedido" };
function emailService(mocks = {}) {
    return load("services/emailService.js", { "../config/env": env, ...mocks });
}
function queueFixture({ send, claims = [], config = env, failCompletion = false } = {}) {
    const calls = [];
    const db = { async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("WITH candidata")) return { rows: claims.length ? [claims.shift()] : [] };
        if (failCompletion && sql.includes("provedor_id=$3")) throw new Error("DB unavailable");
        return { rows: [] };
    }};
    const queue = load("services/emailQueueService.js", {
        "../database/connection": db, "../config/env": config,
        "./emailService": { sendEmail: send || (async () => ({ id: "provider-id" })) }
    });
    return { queue, calls, db };
}
function queued(attempt = 1, extra = {}) {
    return { id: "queue-id", token_bloqueio: "lease-token", dados: { from: env.EMAIL_FROM, ...message },
        chave_idempotencia: "stable-key", tentativas: attempt, resultado_incerto: false, ...extra };
}

test("cadastro e recuperação continuam síncronos, com timeout e chave do chamador", async t => {
    let request;
    t.mock.method(globalThis, "fetch", async (_, options) => {
        request = options;
        return { ok: true, status: 200, async json() { return { id: "critical-id" }; } };
    });
    const service = emailService({ "./emailQueueService": { enqueueEmail() { throw new Error("Não deveria enfileirar"); } } });
    assert.deepEqual(await service.sendEmail({ ...message, idempotencyKey: "verify-token-hash" }), { id: "critical-id" });
    assert.equal(request.headers["Idempotency-Key"], "verify-token-hash");
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(JSON.parse(request.body).from, env.EMAIL_FROM);
});

test("e-mail opcional persiste e não chama o provedor no caminho da requisição", async t => {
    t.mock.method(globalThis, "fetch", () => { throw new Error("Não deveria acessar rede"); });
    let persisted;
    const service = emailService({ "./emailQueueService": { async enqueueEmail(options) { persisted = options; return { id: "outbox", status: "PENDENTE" }; } } });
    assert.deepEqual(await service.sendOptionalEmail(message), { id: "outbox", status: "PENDENTE" });
    assert.deepEqual(persisted, message);
});

test("falha de persistência opcional não expõe conteúdo e retorna null", async t => {
    const logs = [];
    t.mock.method(console, "warn", (...args) => logs.push(args));
    const service = emailService({ "./emailQueueService": { async enqueueEmail() { throw new Error(message.to + message.text); } } });
    assert.equal(await service.sendOptionalEmail(message), null);
    assert.doesNotMatch(JSON.stringify(logs), /customer|Dados privados/);
});

test("Resend: 429/conflito concorrente repetem; validação e conflito de payload encerram", async t => {
    let status = 429, name = "rate_limit_exceeded";
    t.mock.method(globalThis, "fetch", async () => ({ ok: false, status,
        headers: { get() { return "180"; } }, async json() { return { name, message: "resposta sensível" }; }
    }));
    const service = emailService();
    await assert.rejects(service.sendEmail(message), error => error.emailRetryable && !error.emailAmbiguous && error.retryAfterSeconds === 180);
    status = 409; name = "concurrent_idempotent_requests";
    await assert.rejects(service.sendEmail(message), error => error.emailRetryable && !error.emailAmbiguous);
    name = "invalid_idempotent_request";
    await assert.rejects(service.sendEmail(message), error => !error.emailRetryable && error.emailCode === "EMAIL_REJECTED");
    status = 422;
    await assert.rejects(service.sendEmail(message), error => !error.emailRetryable);
    status = 503;
    await assert.rejects(service.sendEmail(message), error => error.emailRetryable && error.emailAmbiguous);
});

test("perda de resposta deixa resultado incerto sem expor a exceção de rede", async t => {
    t.mock.method(globalThis, "fetch", async () => { throw new Error("token privado e conteúdo"); });
    await assert.rejects(emailService().sendEmail(message), error =>
        error.emailRetryable && error.emailAmbiguous && error.emailCode === "EMAIL_NETWORK" && !error.message.includes("token"));
});

test("resposta de sucesso truncada ou id inválido pode ter entregue e precisa da mesma chave", async t => {
    let payload = null;
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200,
        async json() { if(payload === null) throw new Error("body interrupted"); return payload; }
    }));
    const service = emailService();
    for(const value of [null, {id:{}}, {id:"x".repeat(101)}]) {
        payload=value;
        await assert.rejects(service.sendEmail(message), error => error.emailRetryable && error.emailAmbiguous);
    }
});

test("enqueue usa o client da transação e congela payload/remetente com chave estável", async () => {
    const { queue, calls } = queueFixture();
    const inserts = [];
    const client = { async query(sql, params) { inserts.push({ sql, params }); return { rows: [{ id: "outbox", status: "PENDENTE" }] }; } };
    await queue.enqueueEmail({ ...message, idempotencyKey: "evento-123" }, client);
    await queue.enqueueEmail({ ...message, idempotencyKey: "evento-123" }, client);
    assert.equal(calls.length, 0);
    assert.equal(inserts[0].params[0], inserts[1].params[0]);
    assert.deepEqual(JSON.parse(inserts[0].params[1]), { from: env.EMAIL_FROM, ...message });
    assert.doesNotMatch(inserts[0].params[0], /evento|customer/);
    await assert.rejects(queue.enqueueEmail({ to: message.to }, client), { code: "EMAIL_INVALID" });
    await assert.rejects(queue.enqueueEmail({ ...message, expiresAt: "impossible" }, client), { code: "EMAIL_INVALID" });
});

test("sucesso confirma lease e remove o conteúdo pessoal persistido", async () => {
    let sent;
    const { queue, calls } = queueFixture({ claims: [queued()], send: async options => { sent = options; return { id: "provider-id" }; } });
    assert.deepEqual(await queue.runEmailQueue(), { processed: 1 });
    assert.equal(sent.idempotencyKey, "stable-key");
    const completion = calls.find(call => call.sql.includes("provedor_id=$3"));
    assert.deepEqual(completion.params, ["queue-id", "lease-token", "provider-id"]);
    assert.match(completion.sql, /dados='\{\}'::jsonb/);
});

test("erro temporário agenda backoff e respeita Retry-After sem trocar a chave", async t => {
    t.mock.method(console, "warn", () => {});
    const { queue, calls } = queueFixture({ claims: [queued(2)], send: async () => {
        throw Object.assign(new Error("sensitive"), { emailRetryable: true, emailAmbiguous: false, emailCode: "EMAIL_RATE_LIMIT", retryAfterSeconds: 300 });
    }});
    await queue.runEmailQueue();
    const failure = calls.find(call => call.sql.includes("status=$3"));
    assert.deepEqual(failure.params, ["queue-id", "lease-token", "PENDENTE", false, "EMAIL_RATE_LIMIT", 300]);
    assert.equal(queue.retryDelaySeconds(1), 60);
    assert.equal(queue.retryDelaySeconds(2), 120);
});

test("rejeição definitiva e esgotamento incerto encerram com estados diferentes", async t => {
    t.mock.method(console, "warn", () => {});
    for (const [item, error, expected] of [
        [queued(), { emailRetryable: false, emailAmbiguous: false }, "FALHA"],
        [queued(8), { emailRetryable: true, emailAmbiguous: true }, "INCERTA"],
        [queued(2, { resultado_incerto: true }), { emailRetryable: false, emailAmbiguous: false }, "INCERTA"]
    ]) {
        const { queue, calls } = queueFixture({ claims: [item], send: async () => { throw Object.assign(new Error("private"), error); } });
        await queue.runEmailQueue();
        assert.equal(calls.find(call => call.sql.includes("status=$3")).params[2], expected);
    }
});

test("falha ao confirmar entrega deixa lease recuperável e reutiliza a mesma chave", async () => {
    const keys = [];
    const fixture = queueFixture({ claims: [queued()], failCompletion: true,
        send: async options => { keys.push(options.idempotencyKey); return { id: "provider-id" }; } });
    await assert.rejects(fixture.queue.runEmailQueue(), /DB unavailable/);
    const recovery = queueFixture({ claims: [queued(2, { token_bloqueio: "new-lease", resultado_incerto: true })],
        send: async options => { keys.push(options.idempotencyKey); return { id: "provider-id" }; } });
    await recovery.queue.runEmailQueue();
    assert.deepEqual(keys, ["stable-key", "stable-key"]);
    assert.ok(!fixture.calls.some(call => call.sql.includes("status=$3")));
});

test("worker local não sobrepõe envio e configuração ausente preserva eventos sem tentativa", async () => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const { queue } = queueFixture({ claims: [queued()], send: async () => { await held; return { id: "ok" }; } });
    const first = queue.runEmailQueue();
    assert.deepEqual(await queue.runEmailQueue(), { skipped: true, processed: 0 });
    release();
    await first;
    const disabled = queueFixture({ config: { ...env, RESEND_API_KEY: "" }, claims: [queued()] });
    assert.deepEqual(await disabled.queue.runEmailQueue(), { skipped: true, processed: 0 });
    assert.ok(!disabled.calls.some(call => call.sql.includes("WITH candidata")));
});
