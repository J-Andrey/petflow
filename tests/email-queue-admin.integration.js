"use strict";

// Chamado pelo runner PostgreSQL somente após aplicar todas as migrações.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { load } = require("./helpers");
const admin = require("../services/emailQueueAdminService");
const { MAX_ATTEMPTS, RETRY_WINDOW_SECONDS } = require("../services/emailQueuePolicy");

module.exports = async function verifyEmailQueueAdmin({ db }) {
    const database = (await db.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database, /^petflow_test[a-z0-9_]*$/);
    const marker = crypto.randomUUID();
    const company = (await db.query("INSERT INTO empresas(nome) VALUES('Admin de e-mails teste') RETURNING id")).rows[0].id;
    const other = (await db.query("INSERT INTO empresas(nome) VALUES('Admin de e-mails outra empresa') RETURNING id")).rows[0].id;
    const user = (await db.query(`INSERT INTO usuarios(empresa_id,nome,email,senha_hash,perfil)
        VALUES($1,'Admin de e-mails teste',$2,'synthetic-hash','ADMIN') RETURNING id`,
    [company, marker + "@example.test"])).rows[0].id;
    const req = { user: { id: user, empresaId: company, perfil: "ADMIN" }, query: {}, ip: "127.0.0.1" };
    const queue = load("services/emailQueueService.js", {
        "../database/connection": db,
        "../config/env": { EMAIL_FROM: "sender@example.test" },
        "./emailService": { async sendEmail() { assert.fail("A administração não deve chamar o provedor de e-mail."); } }
    });
    const payload = { to: "private@example.test", subject: "PRIVATE-SUBJECT", text: "PRIVATE-CONTENT" };
    const row = async id => (await db.query("SELECT * FROM fila_emails WHERE id=$1", [id])).rows[0];
    const audits = async id => (await db.query(`SELECT empresa_id,usuario_id,acao,entidade,entidade_id,
        descricao,dados_anteriores,dados_novos,ip FROM auditoria_admin
        WHERE entidade='fila_emails' AND entidade_id=$1 ORDER BY created_at,id`, [id])).rows;
    async function failed(label, empresaId = company) {
        const item = await queue.enqueueEmail({ ...payload, empresaId, idempotencyKey: marker + ":" + label });
        await db.query(`UPDATE fila_emails SET status='FALHA',tentativas=2,
            primeira_tentativa_em=NOW()-INTERVAL '1 hour',proxima_tentativa_em=NOW()+INTERVAL '5 minutes',
            erro_codigo='EMAIL_REJECTED',provedor_id='PRIVATE-PROVIDER-ID' WHERE id=$1`, [item.id]);
        return row(item.id);
    }

    const retry = await failed("retry");
    const uncertain = await failed("uncertain");
    await db.query("UPDATE fila_emails SET status='INCERTA',resultado_incerto=TRUE WHERE id=$1", [uncertain.id]);
    const foreign = await failed("foreign", other);
    const legacy = await failed("legacy", null);

    // Consulta, contadores e buscas devem respeitar a empresa autenticada;
    // e-mails legados sem empresa comprovada ficam fora da administração.
    const listing = await admin.list(db, { ...req, query: { empresa_id: other } });
    assert.deepEqual(new Set(listing.data.map(item => item.id)), new Set([retry.id, uncertain.id]));
    assert.deepEqual(listing.resumo, { PENDENTE: 0, PROCESSANDO: 0, ENVIADA: 0, FALHA: 1, INCERTA: 1 });
    assert.equal(listing.pendencias, 2);
    assert.equal(listing.data.find(item => item.id === retry.id).pode_reagendar, true);
    assert.equal(listing.data.find(item => item.id === uncertain.id).pode_reagendar, false);
    assert.doesNotMatch(JSON.stringify(listing), /private|PRIVATE|chave_idempotencia|dados|provedor_id|empresa_id/);
    const filtered = await admin.list(db, { ...req, query: { status: "FALHA", q: retry.id } });
    assert.deepEqual(filtered.data.map(item => item.id), [retry.id]);
    for (const hidden of [foreign, legacy]) {
        assert.equal((await admin.list(db, { ...req, query: { q: hidden.id } })).data.length, 0);
        for (const action of ["reagendar", "encerrar"]) {
            await assert.rejects(admin.act(db, { ...req, body: { empresa_id: hidden.empresa_id } }, hidden.id, action), { status: 404 });
        }
        assert.deepEqual(await row(hidden.id), hidden);
        assert.deepEqual(await audits(hidden.id), []);
    }
    const otherListing = await admin.list(db, { ...req, user: { ...req.user, empresaId: other } });
    assert.deepEqual(otherListing.data.map(item => item.id), [foreign.id]);
    assert.equal(otherListing.pendencias, 1);

    // A mesma chave não duplica o evento nem atravessa a fronteira da empresa.
    const duplicate = await queue.enqueueEmail({ ...payload, empresaId: company, idempotencyKey: marker + ":retry" });
    assert.equal(duplicate.id, retry.id);
    await assert.rejects(queue.enqueueEmail({ ...payload, empresaId: other, idempotencyKey: marker + ":retry" }), { code: "EMAIL_SCOPE_CONFLICT" });
    assert.deepEqual(await row(retry.id), retry);

    // Exercita expressões JSONB e temporais no PostgreSQL, além dos limites de
    // tentativas: nenhum destes estados pode voltar à fila por ação do admin.
    const blocked = [uncertain.id];
    const ambiguous = await failed("ambiguous");
    await db.query("UPDATE fila_emails SET resultado_incerto=TRUE WHERE id=$1", [ambiguous.id]);
    blocked.push(ambiguous.id);
    const exhausted = await failed("exhausted");
    await db.query("UPDATE fila_emails SET tentativas=$2 WHERE id=$1", [exhausted.id, MAX_ATTEMPTS]);
    blocked.push(exhausted.id);
    const expired = await failed("expired");
    await db.query("UPDATE fila_emails SET expira_em=NOW()-INTERVAL '1 second' WHERE id=$1", [expired.id]);
    blocked.push(expired.id);
    const old = await failed("outside-window");
    await db.query("UPDATE fila_emails SET primeira_tentativa_em=NOW()-($2 * INTERVAL '1 second') WHERE id=$1", [old.id, RETRY_WINDOW_SECONDS + 60]);
    blocked.push(old.id);
    const redacted = await failed("redacted");
    await db.query("UPDATE fila_emails SET dados='{}'::jsonb WHERE id=$1", [redacted.id]);
    blocked.push(redacted.id);
    for (const id of blocked) {
        const before = await row(id);
        const visible = (await admin.list(db, { ...req, query: { q: id } })).data[0];
        assert.equal(visible.pode_reagendar, false);
        await assert.rejects(admin.act(db, req, id, "reagendar"), { status: 409 });
        assert.deepEqual(await row(id), before);
        assert.deepEqual(await audits(id), []);
    }

    // Duas conexões disputam o FOR UPDATE: só a primeira altera o estado e
    // registra auditoria. A janela, a chave e o contador nunca são reiniciados.
    const rescheduled = await Promise.all([
        admin.act(db, req, retry.id, "reagendar"),
        admin.act(db, req, retry.id, "reagendar")
    ]);
    assert.ok(rescheduled.every(item => item.status === "PENDENTE"));
    assert.deepEqual(rescheduled[0].proxima_tentativa_em, rescheduled[1].proxima_tentativa_em);
    const afterRetry = await row(retry.id);
    assert.equal(afterRetry.status, "PENDENTE");
    assert.equal(afterRetry.tentativas, retry.tentativas);
    assert.equal(afterRetry.chave_idempotencia, retry.chave_idempotencia);
    assert.deepEqual(afterRetry.primeira_tentativa_em, retry.primeira_tentativa_em);
    assert.deepEqual(afterRetry.expira_em, retry.expira_em);
    assert.deepEqual(afterRetry.dados, retry.dados);
    assert.equal(afterRetry.resultado_incerto, false);
    assert.ok(afterRetry.proxima_tentativa_em < retry.proxima_tentativa_em);
    const retryAudit = await audits(retry.id);
    assert.equal(retryAudit.length, 1);
    assert.equal(retryAudit[0].empresa_id, company);
    assert.equal(retryAudit[0].usuario_id, user);
    assert.equal(retryAudit[0].acao, "REAGENDAR_EMAIL");
    assert.deepEqual(retryAudit[0].dados_anteriores, { status: "FALHA" });
    assert.deepEqual(retryAudit[0].dados_novos, { status: "PENDENTE" });
    assert.doesNotMatch(JSON.stringify(retryAudit), /private|PRIVATE|chave_idempotencia|provedor_id/);
    await db.query("UPDATE fila_emails SET proxima_tentativa_em=NOW()+INTERVAL '1 hour' WHERE id=$1", [retry.id]);
    const waiting = await row(retry.id);
    await admin.act(db, req, retry.id, "reagendar");
    assert.deepEqual(await row(retry.id), waiting);
    assert.deepEqual(await audits(retry.id), retryAudit);

    // Falha real na FK da auditoria desfaz o reagendamento na mesma transação.
    const rollback = await failed("audit-rollback");
    await assert.rejects(admin.act(db, { ...req, user: { ...req.user, id: crypto.randomUUID() } }, rollback.id, "reagendar"),
        error => error.code === "23503" && error.table === "auditoria_admin");
    assert.deepEqual(await row(rollback.id), rollback);
    assert.deepEqual(await audits(rollback.id), []);

    // Encerrar INCERTA é idempotente, remove conteúdo pessoal e conserva a
    // evidência de incerteza, sem criar novo envio nem zerar tentativas.
    const beforeClose = await row(uncertain.id);
    const closed = await Promise.all([
        admin.act(db, req, uncertain.id, "encerrar"),
        admin.act(db, req, uncertain.id, "encerrar")
    ]);
    assert.deepEqual(closed[0].tratada_em, closed[1].tratada_em);
    assert.ok(closed.every(item => item.pode_encerrar === false && item.pode_reagendar === false));
    const afterClose = await row(uncertain.id);
    assert.ok(afterClose.tratada_em);
    assert.equal(afterClose.tratada_por, user);
    assert.deepEqual(afterClose.dados, {});
    assert.equal(afterClose.status, "INCERTA");
    assert.equal(afterClose.resultado_incerto, true);
    assert.equal(afterClose.tentativas, beforeClose.tentativas);
    assert.equal(afterClose.chave_idempotencia, beforeClose.chave_idempotencia);
    assert.deepEqual(afterClose.primeira_tentativa_em, beforeClose.primeira_tentativa_em);
    const closeAudit = await audits(uncertain.id);
    assert.equal(closeAudit.length, 1);
    assert.equal(closeAudit[0].empresa_id, company);
    assert.equal(closeAudit[0].usuario_id, user);
    assert.equal(closeAudit[0].acao, "ENCERRAR_ANALISE_EMAIL");
    assert.deepEqual(closeAudit[0].dados_anteriores, { status: "INCERTA" });
    assert.deepEqual(closeAudit[0].dados_novos, { status: "INCERTA", descricao: "Análise encerrada sem novo envio." });
    assert.doesNotMatch(JSON.stringify(closeAudit), /private|PRIVATE|chave_idempotencia|provedor_id/);
    await assert.rejects(admin.act(db, req, uncertain.id, "reagendar"), { status: 409 });
    assert.deepEqual(await row(uncertain.id), afterClose);
    assert.deepEqual(await audits(uncertain.id), closeAudit);
    const finalListing = await admin.list(db, req);
    assert.equal(finalListing.resumo.INCERTA, 1);
    assert.equal(finalListing.pendencias, finalListing.resumo.FALHA);
};
