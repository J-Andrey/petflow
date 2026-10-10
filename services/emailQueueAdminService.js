"use strict";

const audit = require("./auditService");
const { MAX_ATTEMPTS, RETRY_WINDOW_SECONDS } = require("./emailQueuePolicy");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["PENDENTE", "PROCESSANDO", "ENVIADA", "FALHA", "INCERTA"];
const error = (message, status = 400) => Object.assign(new Error(message), { status });
// Nenhum destinatário, assunto, conteúdo, chave ou resposta do provedor sai deste serviço.
const COLUMNS = `id,status,tentativas,proxima_tentativa_em,primeira_tentativa_em,
    resultado_incerto,erro_codigo,criada_em,atualizada_em,expira_em,tratada_em,
    (dados ? 'to' AND dados ? 'subject' AND (dados ? 'html' OR dados ? 'text')) AS conteudo_disponivel,
    (expira_em > NOW() AND (primeira_tentativa_em IS NULL
        OR primeira_tentativa_em > NOW()-INTERVAL '${RETRY_WINDOW_SECONDS} seconds')) AS prazo_valido`;
const MESSAGES = {
    EMAIL_CONFIG: "Integração de e-mail não configurada.",
    EMAIL_NETWORK: "A conexão terminou sem confirmação do provedor.",
    EMAIL_PROVIDER: "O provedor ficou indisponível ou não confirmou a solicitação.",
    EMAIL_RATE_LIMIT: "O provedor limitou temporariamente os envios.",
    EMAIL_REJECTED: "O provedor recusou o envio. Confira a configuração antes de reagendar.",
    EMAIL_UNAVAILABLE: "Envio indisponível.",
    EMAIL_EXPIRED: "O prazo útil desta mensagem expirou.",
    RETRY_LIMIT: "Limite de tentativas ou janela de repetição atingido."
};
function canRetry(row) {
    return row.status === "FALHA" && row.resultado_incerto === false && !row.tratada_em &&
        row.conteudo_disponivel === true && row.prazo_valido === true && row.tentativas < MAX_ATTEMPTS;
}
function publicRow(row) {
    const { id, status, tentativas, proxima_tentativa_em, criada_em, atualizada_em, expira_em, tratada_em } = row;
    return { id, status, tentativas, proxima_tentativa_em, criada_em, atualizada_em, expira_em, tratada_em,
        orientacao: MESSAGES[row.erro_codigo] || (row.erro_codigo ? "Falha de envio. Confira a integração." : ""),
        pode_reagendar: canRetry(row), pode_encerrar: !tratada_em && ["FALHA", "INCERTA"].includes(status) };
}
function company(req, write = false) {
    const role = req.user?.cargo || req.user?.perfil;
    if (!req.user || !UUID.test(req.user.empresaId || "")) throw error("Usuário não autenticado.", 401);
    if (!(write ? ["ADMIN"] : ["ADMIN", "GERENTE"]).includes(role)) throw error("Você não possui permissão para esta operação.", 403);
    return req.user.empresaId;
}
async function list(db, req) {
    const empresaId = company(req);
    const status = req.query?.status || null;
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query?.page, 10) || 1));
    if (status && !STATUSES.includes(status)) throw error("Estado da fila inválido.");
    const search = String(req.query?.q || "").trim().slice(0, 100);
    const rows = await db.query(`SELECT ${COLUMNS} FROM fila_emails
        WHERE empresa_id=$1 AND ($2::text IS NULL OR status=$2)
          AND id::text ILIKE $3 ORDER BY criada_em DESC,id LIMIT 25 OFFSET $4`,
    [empresaId, status, "%" + search + "%", (page - 1) * 25]);
    const counts = await db.query(`SELECT status,COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE tratada_em IS NULL)::integer AS sem_tratamento
        FROM fila_emails WHERE empresa_id=$1 GROUP BY status`, [empresaId]);
    const resumo = Object.fromEntries(STATUSES.map(value => [value, 0]));
    let pendencias = 0;
    for (const row of counts.rows) {
        if (STATUSES.includes(row.status)) resumo[row.status] = row.total;
        if (["FALHA", "INCERTA"].includes(row.status)) pendencias += row.sem_tratamento;
    }
    return { data: rows.rows.map(publicRow), page, resumo, pendencias };
}
async function act(db, req, id, action) {
    const empresaId = company(req, true);
    if (!UUID.test(id || "") || !["reagendar", "encerrar"].includes(action)) throw error("Operação inválida.");
    return db.transaction(async client => {
        const found = await client.query(`SELECT ${COLUMNS} FROM fila_emails
            WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [id, empresaId]);
        const before = found.rows[0];
        if (!before) throw error("Registro de e-mail não encontrado.", 404);
        if (action === "reagendar") {
            // Uma repetição do clique não altera a espera nem cria outro evento.
            if (before.status === "PENDENTE" && !before.tratada_em) return publicRow(before);
            if (!canRetry(before)) throw error("Este envio não pode ser repetido com segurança. Confira a situação e encerre a análise sem reenviar.", 409);
            const updated = await client.query(`UPDATE fila_emails SET status='PENDENTE',
                proxima_tentativa_em=NOW(),atualizada_em=NOW()
                WHERE id=$1 AND empresa_id=$2 RETURNING ${COLUMNS}`, [id, empresaId]);
            await audit.record(client, req, "REAGENDAR_EMAIL", "fila_emails", id,
                { status: before.status }, { status: "PENDENTE" });
            return publicRow(updated.rows[0]);
        }
        if (!["FALHA", "INCERTA"].includes(before.status)) throw error("Só é possível encerrar a análise de envios com falha ou sem confirmação.", 409);
        if (before.tratada_em) return publicRow(before);
        const updated = await client.query(`UPDATE fila_emails SET tratada_em=NOW(),tratada_por=$3,
            dados='{}'::jsonb,atualizada_em=NOW() WHERE id=$1 AND empresa_id=$2 RETURNING ${COLUMNS}`,
        [id, empresaId, req.user.id]);
        await audit.record(client, req, "ENCERRAR_ANALISE_EMAIL", "fila_emails", id,
            { status: before.status }, { status: before.status, descricao: "Análise encerrada sem novo envio." });
        return publicRow(updated.rows[0]);
    });
}
module.exports = { list, act };
