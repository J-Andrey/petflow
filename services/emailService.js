"use strict";

const {
    RESEND_API_KEY,
    EMAIL_FROM,
    APP_URL
} = require("../config/env");

async function sendEmail({ to, subject, html, text, idempotencyKey, from = EMAIL_FROM }) {
    if (!RESEND_API_KEY) {
        throw emailError("Serviço de e-mail indisponível. Tente novamente mais tarde.", "EMAIL_CONFIG", true, false);
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
            from,
            to,
            subject,
            html,
            text
        })
    }).catch(() => { throw emailError("Não foi possível contatar o serviço de e-mail.", "EMAIL_NETWORK", true, true); });

    const payload = await response.json().catch(() => null);

    if (!response.ok || typeof payload?.id !== "string" || !payload.id || payload.id.length > 100) {
        const concurrent = response.status === 409 && (payload?.name === "concurrent_idempotent_requests" || !payload);
        const retryable = response.ok || response.status === 408 || response.status === 429 || response.status >= 500 || concurrent;
        const ambiguous = response.ok || response.status === 408 || response.status >= 500 || (response.status === 409 && !payload);
        const error = emailError("Não foi possível enviar o e-mail. Tente novamente mais tarde.",
            response.status === 429 ? "EMAIL_RATE_LIMIT" : retryable ? "EMAIL_PROVIDER" : "EMAIL_REJECTED", retryable, ambiguous);
        const retryAfter = response.headers?.get?.("retry-after");
        if (retryAfter) {
            error.retryAfterSeconds = /^\d+$/.test(retryAfter)
                ? Number(retryAfter) : Math.max(0, Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000));
        }
        throw error;
    }

    return payload;
}

async function sendOptionalEmail(options) {
    try {
        return await enqueueEmail(options);
    } catch (error) {
        console.warn("[email] e-mail opcional não enfileirado");
        return null;
    }
}

function enqueueEmail(options, client) {
    return require("./emailQueueService").enqueueEmail(options, client);
}

function emailError(message, emailCode, emailRetryable, emailAmbiguous) {
    return Object.assign(new Error(message), { status: 503, emailCode, emailRetryable, emailAmbiguous });
}

function welcomeTemplate({ name }) {
    const safeName = escapeHtml(firstName(name) || "cliente");
    const message = `${safeName}, seu cadastro foi criado com sucesso. Agora você pode comprar, favoritar produtos e acompanhar seus pedidos.`;

    return {
        subject: "Cadastro criado na PetFlow",
        text: message,
        html: baseEmail(`
            <h1>Bem-vindo à PetFlow</h1>
            <p>${message}</p>
        `)
    };
}

function emailVerificationTemplate({ name, verifyUrl }) {
    const safeName = escapeHtml(firstName(name) || "cliente");

    return {
        subject: "Confirme seu e-mail na PetFlow",
        text: `Olá, ${safeName}. Confirme seu e-mail para ativar sua conta PetFlow: ${verifyUrl}`,
        html: baseEmail(`
            <h1>Confirme seu e-mail</h1>
            <p>Olá, ${safeName}.</p>
            <p>Recebemos seu cadastro na PetFlow. Para ativar sua conta e poder comprar, confirme seu e-mail pelo botão abaixo.</p>
            <p>
                <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#04766d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">
                    Confirmar e-mail
                </a>
            </p>
            <p style="color:#647481;font-size:13px">Se você não fez este cadastro, ignore este e-mail.</p>
        `)
    };
}

function passwordResetTemplate({ name, resetUrl }) {
    const safeName = escapeHtml(firstName(name) || "cliente");

    return {
        subject: "Redefinição de senha PetFlow",
        text: `Olá, ${safeName}. Use este link para redefinir sua senha: ${resetUrl}`,
        html: baseEmail(`
            <h1>Redefinição de senha</h1>
            <p>Olá, ${safeName}.</p>
            <p>Recebemos uma solicitação para redefinir sua senha na PetFlow.</p>
            <p>
                <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#04766d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">
                    Criar nova senha
                </a>
            </p>
            <p>Se você não solicitou essa alteração, ignore este e-mail.</p>
            <p style="color:#647481;font-size:13px">Este link expira por segurança.</p>
        `)
    };
}

function appointmentReminderTemplate({ name, petName, serviceName, date, time }) {
    const safeName = escapeHtml(firstName(name) || "cliente");
    const safePet = escapeHtml(petName || "seu pet");
    const safeService = escapeHtml(serviceName || "atendimento");
    const when = `${formatDate(date)} às ${formatTime(time)}`;

    return {
        subject: `Lembrete de agendamento - ${safePet}`,
        text: `Olá, ${safeName}. Lembrete: ${safeService} do ${safePet} está agendado para ${when}.`,
        html: baseEmail(`
            <h1>Lembrete de agendamento</h1>
            <p>Olá, ${safeName}.</p>
            <p>Passando para lembrar que <strong>${safeService}</strong> do <strong>${safePet}</strong> está agendado para <strong>${escapeHtml(when)}</strong>.</p>
            <p>Se precisar remarcar, entre em contato com a PetFlow.</p>
        `)
    };
}

function birthdayGreetingTemplate({ name }) {
    const safeName = escapeHtml(firstName(name) || "cliente");

    return {
        subject: "Feliz aniversário - PetFlow",
        text: `Olá, ${safeName}. A PetFlow deseja um feliz aniversário!`,
        html: baseEmail(`
            <h1>Feliz aniversário!</h1>
            <p>Olá, ${safeName}.</p>
            <p>A equipe PetFlow deseja um dia muito especial, com carinho, saúde e bons momentos.</p>
        `)
    };
}

function orderReceivedTemplate({ name, orderId, total, items = [] }) {
    const safeName = escapeHtml(firstName(name) || "cliente");
    const orderLabel = shortId(orderId);
    const itemList = items.map(item => `
        <li style="padding:10px 0;border-bottom:1px solid #e5edf0">
            ${escapeHtml(item.nome || "Produto")}
            <strong style="float:right">${Number(item.quantidade || 1)}x ${currency(item.valor_unitario)}</strong>
        </li>
    `).join("");

    return {
        subject: `Pedido recebido #${orderLabel} - PetFlow`,
        text: `Olá, ${safeName}. Recebemos seu pedido #${orderLabel} no valor de ${currency(total)}.`,
        html: baseEmail(`
            <h1>Pedido recebido</h1>
            <p>Olá, ${safeName}.</p>
            <p>Recebemos seu pedido <strong>#${orderLabel}</strong>. A PetFlow vai acompanhar a separação e entrega pelo painel administrativo.</p>
            <ul style="list-style:none;padding:0;margin:18px 0;color:#10212b">
                ${itemList}
            </ul>
            <p style="font-size:18px"><strong>Total: ${currency(total)}</strong></p>
        `)
    };
}

function paymentApprovedTemplate({ name, orderId, total }) {
    const safeName = escapeHtml(firstName(name) || "cliente");
    const orderLabel = shortId(orderId);

    return {
        subject: `Pagamento aprovado #${orderLabel} - PetFlow`,
        text: `Olá, ${safeName}. O pagamento do pedido #${orderLabel} foi aprovado no valor de ${currency(total)}.`,
        html: baseEmail(`
            <h1>Pagamento aprovado</h1>
            <p>Olá, ${safeName}.</p>
            <p>O pagamento do pedido <strong>#${orderLabel}</strong> foi aprovado. Agora vamos separar tudo com cuidado para a entrega.</p>
            <p style="font-size:18px"><strong>Total: ${currency(total)}</strong></p>
        `)
    };
}

function orderOutForDeliveryTemplate({ name, orderId }) {
    const safeName = escapeHtml(firstName(name) || "cliente");
    const orderLabel = shortId(orderId);

    return {
        subject: `Pedido saiu para entrega #${orderLabel} - PetFlow`,
        text: `Olá, ${safeName}. Seu pedido #${orderLabel} saiu para entrega.`,
        html: baseEmail(`
            <h1>Pedido saiu para entrega</h1>
            <p>Olá, ${safeName}.</p>
            <p>Seu pedido <strong>#${orderLabel}</strong> saiu para entrega e está a caminho.</p>
        `)
    };
}

function orderDeliveredTemplate({ name, orderId }) {
    const safeName = escapeHtml(firstName(name) || "cliente");
    const orderLabel = shortId(orderId);

    return {
        subject: `Pedido entregue #${orderLabel} - PetFlow`,
        text: `Olá, ${safeName}. Seu pedido #${orderLabel} foi entregue.`,
        html: baseEmail(`
            <h1>Pedido entregue</h1>
            <p>Olá, ${safeName}.</p>
            <p>Seu pedido <strong>#${orderLabel}</strong> foi entregue. Obrigado por comprar com a PetFlow.</p>
        `)
    };
}

function orderCanceledTemplate({ name, orderId }) {
    const safeName = escapeHtml(firstName(name) || "cliente");
    const orderLabel = shortId(orderId);

    return {
        subject: `Pedido cancelado #${orderLabel} - PetFlow`,
        text: `Olá, ${safeName}. Seu pedido #${orderLabel} foi cancelado.`,
        html: baseEmail(`
            <h1>Pedido cancelado</h1>
            <p>Olá, ${safeName}.</p>
            <p>Seu pedido <strong>#${orderLabel}</strong> foi cancelado. Se tiver dúvidas, entre em contato com a PetFlow.</p>
        `)
    };
}

function newsletterConfirmationTemplate({ name, email, token }) {
    const safeName = escapeHtml(firstName(name) || "cliente");
    const unsubscribeUrl = `${APP_URL}/newsletter/cancelar?email=${encodeURIComponent(String(email || ""))}&token=${encodeURIComponent(String(token || ""))}`;

    return {
        subject: "Inscrição confirmada na newsletter PetFlow",
        text: `Olá, ${safeName}. Sua inscrição na newsletter da PetFlow foi confirmada. Para cancelar: ${unsubscribeUrl}`,
        html: baseEmail(`
            <h1>Inscrição confirmada</h1>
            <p>Olá, ${safeName}.</p>
            <p>Você entrou para a lista da PetFlow. Vamos enviar novidades, promoções e dicas úteis para cuidar melhor do seu pet.</p>
            <p style="font-size:13px"><a href="${escapeHtml(unsubscribeUrl)}">Cancelar inscrição na newsletter</a></p>
            <p style="color:#647481;font-size:13px">Se você não fez esta inscrição, ignore este e-mail.</p>
        `)
    };
}

function baseEmail(content) {
    return `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#10212b;line-height:1.55">
            ${content}
            <hr style="border:0;border-top:1px solid #e5edf0;margin:24px 0">
            <p style="color:#647481;font-size:13px">PetFlow - cuidado, loja e serviços para pets.</p>
        </div>
    `;
}

function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0];
}

function shortId(id) {
    return String(id || "").slice(0, 8).toUpperCase();
}

function currency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function formatDate(value) {
    if (!value) {
        return "data combinada";
    }

    return new Date(value).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC"
    });
}

function formatTime(value) {
    return String(value || "").slice(0, 5) || "horário combinado";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

module.exports = {
    sendEmail,
    sendOptionalEmail,
    enqueueEmail,
    welcomeTemplate,
    emailVerificationTemplate,
    passwordResetTemplate,
    appointmentReminderTemplate,
    birthdayGreetingTemplate,
    orderReceivedTemplate,
    paymentApprovedTemplate,
    orderOutForDeliveryTemplate,
    orderDeliveredTemplate,
    orderCanceledTemplate,
    newsletterConfirmationTemplate
};
