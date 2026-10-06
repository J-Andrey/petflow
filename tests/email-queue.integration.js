"use strict";

// Chamado apenas pelo teste PostgreSQL que já exige um banco sintético separado.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { load } = require("./helpers");

module.exports = async function verifyEmailQueue(pool) {
    const database = (await pool.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database, /^petflow_test[a-z0-9_]*$/);
    const schema = "queue_test_" + crypto.randomUUID().replace(/-/g, "");
    await pool.query(`CREATE SCHEMA "${schema}"`);
    async function transaction(callback) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(`SET LOCAL search_path TO "${schema}",public`);
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }
    const db = { transaction, query: (sql, params) => transaction(client => client.query(sql, params)) };
    const env = { RESEND_API_KEY: "unit-only", EMAIL_FROM: "sender@example.test" };
    const createQueue = sendEmail => load("services/emailQueueService.js", {
        "../database/connection": db, "../config/env": env, "./emailService": { sendEmail }
    });
    const deliveries = [];
    const sender = async options => {
        deliveries.push(options);
        await new Promise(resolve => setTimeout(resolve, 10));
        return { id: "synthetic-provider-id" };
    };
    const queue = createQueue(sender);
    const otherWorker = createQueue(sender);
    const message = { to: "synthetic@example.test", subject: "Teste da fila", text: "Conteúdo sintético" };
    try {
        await db.query(await fs.readFile(path.join(__dirname, "../database/sql/119_fila_emails.sql"), "utf8"));

        await assert.rejects(transaction(async client => {
            await queue.enqueueEmail({ ...message, idempotencyKey: "rollback" }, client);
            throw new Error("business failure");
        }), /business failure/);
        assert.equal((await db.query("SELECT COUNT(*)::integer AS total FROM fila_emails")).rows[0].total, 0);

        const committed = await transaction(client => queue.enqueueEmail({ ...message, idempotencyKey: "committed" }, client));
        const concurrent = await Promise.all([
            queue.enqueueEmail({ ...message, idempotencyKey: "duplicate-event" }),
            otherWorker.enqueueEmail({ ...message, idempotencyKey: "duplicate-event" })
        ]);
        assert.equal(concurrent[0].id, concurrent[1].id);
        assert.equal((await db.query("SELECT COUNT(*)::integer AS total FROM fila_emails")).rows[0].total, 2);
        await Promise.all([queue.runEmailQueue(), otherWorker.runEmailQueue()]);
        assert.equal(deliveries.length, 2);
        assert.equal(new Set(deliveries.map(item => item.idempotencyKey)).size, 2);
        const done = (await db.query("SELECT * FROM fila_emails WHERE id=$1", [committed.id])).rows[0];
        assert.equal(done.status, "ENVIADA");
        assert.equal(done.tentativas, 1);
        assert.deepEqual(done.dados, {});

        const retry = await queue.enqueueEmail({ ...message, idempotencyKey: "network-retry" });
        const failedKeys = [];
        const failingWorker = createQueue(async options => {
            failedKeys.push(options.idempotencyKey);
            throw Object.assign(new Error("synthetic timeout"), { emailRetryable: true, emailAmbiguous: true, emailCode: "EMAIL_NETWORK" });
        });
        await failingWorker.runEmailQueue();
        const pending = (await db.query("SELECT * FROM fila_emails WHERE id=$1", [retry.id])).rows[0];
        assert.equal(pending.status, "PENDENTE");
        assert.equal(pending.resultado_incerto, true);
        assert.ok(pending.proxima_tentativa_em.getTime() > Date.now() + 50_000);
        await db.query("UPDATE fila_emails SET proxima_tentativa_em=NOW() WHERE id=$1", [retry.id]);
        await queue.runEmailQueue();
        assert.equal(deliveries.at(-1).idempotencyKey, failedKeys[0]);
        assert.equal((await db.query("SELECT tentativas FROM fila_emails WHERE id=$1", [retry.id])).rows[0].tentativas, 2);

        const crash = await queue.enqueueEmail({ ...message, idempotencyKey: "worker-crash" });
        await db.query(`UPDATE fila_emails SET status='PROCESSANDO',tentativas=1,
            primeira_tentativa_em=NOW()-INTERVAL '5 minutes',token_bloqueio=gen_random_uuid(),
            bloqueada_ate=NOW()-INTERVAL '1 second' WHERE id=$1`, [crash.id]);
        await queue.runEmailQueue();
        const recovered = (await db.query("SELECT * FROM fila_emails WHERE id=$1", [crash.id])).rows[0];
        assert.equal(recovered.status, "ENVIADA");
        assert.equal(recovered.tentativas, 2);
        assert.equal(recovered.resultado_incerto, true);

        const stale = await queue.enqueueEmail({ ...message, idempotencyKey: "stale-reminder", expiresAt: new Date(Date.now()-1000) });
        const sentBeforeExpiry = deliveries.length;
        await queue.runEmailQueue();
        const staleRow = (await db.query("SELECT * FROM fila_emails WHERE id=$1", [stale.id])).rows[0];
        assert.equal(staleRow.status, "FALHA");
        assert.equal(staleRow.erro_codigo, "EMAIL_EXPIRED");
        assert.equal(staleRow.tentativas, 0);
        assert.equal(deliveries.length, sentBeforeExpiry);

        const expired = await queue.enqueueEmail({ ...message, idempotencyKey: "late-uncertain" });
        await db.query(`UPDATE fila_emails SET primeira_tentativa_em=NOW()-INTERVAL '23 hours 1 minute',
            tentativas=1,resultado_incerto=TRUE WHERE id=$1`, [expired.id]);
        const countBefore = deliveries.length;
        await queue.runEmailQueue();
        const closed = (await db.query("SELECT * FROM fila_emails WHERE id=$1", [expired.id])).rows[0];
        assert.equal(closed.status, "INCERTA");
        assert.equal(closed.erro_codigo, "RETRY_LIMIT");
        assert.equal(deliveries.length, countBefore);
        await db.query("UPDATE fila_emails SET atualizada_em=NOW()-INTERVAL '8 days' WHERE id=$1", [expired.id]);
        await queue.runEmailQueue();
        assert.deepEqual((await db.query("SELECT dados FROM fila_emails WHERE id=$1", [expired.id])).rows[0].dados, {});
    } finally {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
};
