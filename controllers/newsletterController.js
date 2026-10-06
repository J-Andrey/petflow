"use strict";

const db = require("../database/connection");
const crypto = require("crypto");
const { JWT_SECRET } = require("../config/env");
const {
    enqueueEmail,
    newsletterConfirmationTemplate
} = require("../services/emailService");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function subscribe(request, response, next) {
    try {
        const nome = clean(request.body?.nome || request.body?.name);
        const email = clean(request.body?.email)?.toLowerCase();
        const consentimento = request.body?.consentimento === true ||
            request.body?.consentimento === "true";

        if (!nome) {
            return response.status(400).json({
                success: false,
                message: "Informe seu nome."
            });
        }

        if (!email || !EMAIL_REGEX.test(email)) {
            return response.status(400).json({
                success: false,
                message: "Informe um e-mail válido."
            });
        }

        if (!consentimento) {
            return response.status(400).json({
                success: false,
                message: "Aceite a Política de Privacidade para continuar."
            });
        }

        const empresaIdResult = await db.query(
            "SELECT get_petflow_empresa_id() AS id"
        );
        const empresaId = empresaIdResult.rows[0]?.id;

        const inscrito = await db.transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["newsletter-"+empresaId+"-"+email]);
        const existing = await client.query(
            `
                SELECT id,status
                FROM newsletter_inscritos
                WHERE empresa_id = $1
                  AND LOWER(email) = LOWER($2)
                LIMIT 1
            `,
            [empresaId, email]
        );

        let inscrito;

        if (existing.rows[0]) {
            const updated = await client.query(
                `
                    UPDATE newsletter_inscritos
                    SET
                        nome = $1,
                        status = 'ATIVO',
                        origem = 'SITE',
                        consentimento = TRUE,
                        data_cancelamento = NULL,
                        updated_at = NOW()
                    WHERE id = $2
                    RETURNING id, nome, email, status
                `,
                [nome, existing.rows[0].id]
            );

            inscrito = updated.rows[0];
        } else {
            const created = await client.query(
                `
                    INSERT INTO newsletter_inscritos (
                        empresa_id,
                        nome,
                        email,
                        origem,
                        consentimento
                    )
                    VALUES ($1,$2,$3,'SITE',TRUE)
                    RETURNING id, nome, email, status
                `,
                [empresaId, nome, email]
            );

            inscrito = created.rows[0];
        }

        const template = newsletterConfirmationTemplate({
            name: inscrito.nome,
            email: inscrito.email,
            token: buildUnsubscribeToken(inscrito.email)
        });

        if(existing.rows[0]?.status !== "ATIVO") {
            await enqueueEmail({
                to: inscrito.email,
                ...template,
                idempotencyKey: "newsletter-confirmada-"+inscrito.id+"-"+crypto.randomUUID()
            }, client);
        }
        return inscrito;
        });

        return response.status(200).json({
            success: true,
            message: "Inscrição realizada com sucesso.",
            data: inscrito
        });
    } catch (error) {
        next(error);
    }
}

async function unsubscribe(request, response, next) {
    try {
        const email = clean(request.query?.email || request.body?.email)?.toLowerCase();
        const token = clean(request.query?.token || request.body?.token);

        if (!email || !token || token !== buildUnsubscribeToken(email)) {
            return response.status(400).json({
                success: false,
                message: "Link de descadastro inválido."
            });
        }

        const empresaIdResult = await db.query(
            "SELECT get_petflow_empresa_id() AS id"
        );
        const empresaId = empresaIdResult.rows[0]?.id;

        await db.query(
            `
                UPDATE newsletter_inscritos
                SET
                    status = 'CANCELADO',
                    data_cancelamento = NOW(),
                    updated_at = NOW()
                WHERE empresa_id = $1
                  AND LOWER(email) = LOWER($2)
            `,
            [empresaId, email]
        );

        return response.status(200).json({
            success: true,
            message: "Inscrição cancelada com sucesso."
        });
    } catch (error) {
        next(error);
    }
}

function buildUnsubscribeToken(email) {
    return crypto
        .createHmac("sha256", JWT_SECRET)
        .update(String(email || "").toLowerCase())
        .digest("hex");
}

function clean(value) {
    return value ? String(value).trim() : "";
}

module.exports = {
    subscribe,
    unsubscribe
};
