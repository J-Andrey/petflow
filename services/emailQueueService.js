"use strict";

const crypto = require("node:crypto");
const db = require("../database/connection");
const { EMAIL_FROM, RESEND_API_KEY } = require("../config/env");
const { sendEmail } = require("./emailService");

const MAX_ATTEMPTS = 8;
// Resend guarda chaves por 24h. A margem evita repetir uma entrega incerta fora da janela.
const RETRY_WINDOW_SECONDS = 23 * 60 * 60;
const LEASE_SECONDS = 120;
const POLL_MS = 30_000;
let workerTimer;
let running = false;

async function enqueueEmail(options, client = db) {
    const { to, subject, html, text, idempotencyKey } = options;
    const expiresAt = options.expiresAt ? new Date(options.expiresAt) : null;
    if (!to || !subject || (!html && !text)) {
        throw Object.assign(new Error("Dados de e-mail incompletos."), { code: "EMAIL_INVALID" });
    }
    if(expiresAt && !Number.isFinite(expiresAt.getTime())) {
        throw Object.assign(new Error("Expiração de e-mail inválida."), { code: "EMAIL_INVALID" });
    }
    // O hash evita guardar chaves fornecidas pelo chamador que contenham dados pessoais.
    const key = "petflow-email-" + crypto.createHash("sha256")
        .update(String(idempotencyKey || crypto.randomUUID())).digest("hex");
    const data = { from: EMAIL_FROM, to, subject, ...(html ? { html } : {}), ...(text ? { text } : {}) };
    const { rows } = await client.query(`
        INSERT INTO fila_emails(chave_idempotencia,dados,expira_em)
        VALUES($1,$2::jsonb,LEAST(COALESCE($3::timestamptz,NOW()+INTERVAL '7 days'),NOW()+INTERVAL '7 days'))
        ON CONFLICT(chave_idempotencia) DO UPDATE
            SET chave_idempotencia=EXCLUDED.chave_idempotencia
        RETURNING id,status`, [key, JSON.stringify(data), expiresAt]);
    return rows[0];
}

function retryDelaySeconds(attempt, retryAfterSeconds = 0) {
    const backoff = Math.min(60 * 2 ** Math.max(0, attempt - 1), 3600);
    return Math.max(backoff, Math.min(Number(retryAfterSeconds) || 0, RETRY_WINDOW_SECONDS));
}

async function claimEmail() {
    const token = crypto.randomUUID();
    // Uma só instrução com SKIP LOCKED permite vários processos sem compartilhar a entrega.
    const { rows } = await db.query(`
        WITH candidata AS (
            SELECT id FROM fila_emails
            WHERE ((status='PENDENTE' AND proxima_tentativa_em <= NOW())
                OR (status='PROCESSANDO' AND bloqueada_ate <= NOW()))
              AND tentativas < $2 AND expira_em > NOW()
              AND (primeira_tentativa_em IS NULL
                  OR primeira_tentativa_em > NOW()-($3 * INTERVAL '1 second'))
            ORDER BY proxima_tentativa_em,criada_em
            FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE fila_emails f SET status='PROCESSANDO',token_bloqueio=$1,
            bloqueada_ate=NOW()+($4 * INTERVAL '1 second'),
            resultado_incerto=f.resultado_incerto OR f.status='PROCESSANDO',
            primeira_tentativa_em=COALESCE(f.primeira_tentativa_em,NOW()),
            tentativas=f.tentativas+1,atualizada_em=NOW()
        FROM candidata c WHERE f.id=c.id RETURNING f.*`,
    [token, MAX_ATTEMPTS, RETRY_WINDOW_SECONDS, LEASE_SECONDS]);
    return rows[0] || null;
}

async function expireEmails() {
    await db.query(`
        UPDATE fila_emails SET
            status=CASE WHEN resultado_incerto OR status='PROCESSANDO' THEN 'INCERTA' ELSE 'FALHA' END,
            erro_codigo=CASE WHEN expira_em <= NOW() THEN 'EMAIL_EXPIRED' ELSE 'RETRY_LIMIT' END,
            token_bloqueio=NULL,bloqueada_ate=NULL,atualizada_em=NOW()
        WHERE (status='PENDENTE' OR (status='PROCESSANDO' AND bloqueada_ate <= NOW()))
          AND (tentativas >= $1 OR expira_em <= NOW()
              OR primeira_tentativa_em <= NOW()-($2 * INTERVAL '1 second'))`,
    [MAX_ATTEMPTS, RETRY_WINDOW_SECONDS]);
    // Preserva chave/status para deduplicação; remove conteúdo pessoal após encerramento.
    await db.query(`UPDATE fila_emails SET dados='{}'::jsonb
        WHERE status IN ('ENVIADA','FALHA','INCERTA')
          AND atualizada_em < NOW()-INTERVAL '7 days' AND dados <> '{}'::jsonb`);
}

async function processEmail(item) {
    let payload;
    try {
        payload = await sendEmail({ ...item.dados, idempotencyKey: item.chave_idempotencia });
    } catch (error) {
        const retryable = error.emailRetryable !== false;
        const uncertain = item.resultado_incerto || error.emailAmbiguous !== false;
        const canRetry = retryable && item.tentativas < MAX_ATTEMPTS;
        const status = canRetry ? "PENDENTE" : uncertain ? "INCERTA" : "FALHA";
        const code = /^[A-Z_]{1,40}$/.test(error.emailCode || "") ? error.emailCode : "EMAIL_UNAVAILABLE";
        const delay = retryDelaySeconds(item.tentativas, error.retryAfterSeconds);
        await db.query(`UPDATE fila_emails SET status=$3,resultado_incerto=$4,erro_codigo=$5,
            proxima_tentativa_em=NOW()+($6 * INTERVAL '1 second'),
            token_bloqueio=NULL,bloqueada_ate=NULL,atualizada_em=NOW()
            WHERE id=$1 AND token_bloqueio=$2 AND status='PROCESSANDO'`,
        [item.id, item.token_bloqueio, status, uncertain, code, delay]);
        console.warn("[email] tentativa encerrada", { id: item.id, tentativa: item.tentativas, status, code });
        return status;
    }
    // Se a gravação falhar, a lease expira e repete a MESMA chave, sem perder o evento.
    await db.query(`UPDATE fila_emails SET status='ENVIADA',provedor_id=$3,dados='{}'::jsonb,
        erro_codigo=NULL,token_bloqueio=NULL,bloqueada_ate=NULL,atualizada_em=NOW()
        WHERE id=$1 AND token_bloqueio=$2 AND status='PROCESSANDO'`,
    [item.id, item.token_bloqueio, payload.id]);
    return "ENVIADA";
}

async function runEmailQueue({ limit = 10 } = {}) {
    if (running) return { skipped: true, processed: 0 };
    running = true;
    let processed = 0;
    try {
        await expireEmails();
        // Sem chave, eventos permanecem sem tentativa até a integração ser configurada.
        if (!RESEND_API_KEY) return { skipped: true, processed };
        const batchSize = Math.max(1, Math.min(100, Math.floor(Number(limit) || 10)));
        for (let i = 0; i < batchSize; i++) {
            const item = await claimEmail();
            if (!item) break;
            await processEmail(item);
            processed++;
        }
        return { processed };
    } finally {
        running = false;
    }
}

function startEmailQueueJob() {
    if (workerTimer) return;
    const run = () => runEmailQueue().catch(() => console.warn("[email] processamento da fila indisponível"));
    workerTimer = setInterval(run, POLL_MS);
    workerTimer.unref?.();
    void run();
}

function stopEmailQueueJob() {
    if (workerTimer) clearInterval(workerTimer);
    workerTimer = null;
}

module.exports = { enqueueEmail, runEmailQueue, startEmailQueueJob, stopEmailQueueJob, retryDelaySeconds };
