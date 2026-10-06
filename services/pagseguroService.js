"use strict";

const axios = require("axios");
const crypto = require("crypto");

const {
    APP_URL,
    PAGSEGURO_BASE_URL,
    PAGSEGURO_TOKEN
} = require("../config/env");

function assertConfigured() {
    if (!PAGSEGURO_BASE_URL || !PAGSEGURO_TOKEN) {
        const error = new Error(
            "PagSeguro/PagBank não configurado no .env."
        );

        error.status = 503;
        throw error;
    }
}

function createClient() {
    assertConfigured();

    return axios.create({
        baseURL: PAGSEGURO_BASE_URL,
        timeout: 30000,
        headers: {
            Authorization: `Bearer ${PAGSEGURO_TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json"
        }
    });
}
async function consultarCobranca(id) {
    try{return (await createClient().get("/charges/"+encodeURIComponent(id))).data;}
    catch(error){throw buildPagSeguroError(error);}
}
async function consultarChargeback(id) {
    if(!/^CBKS_[A-Za-z0-9-]{1,100}$/.test(id))throw Object.assign(new Error("Identificador de chargeback inválido."),{status:400});
    try{return (await createClient().get("/chargebacks/"+encodeURIComponent(id))).data;}
    catch(error){throw buildPagSeguroError(error);}
}
async function reembolsar(id,cents,key) {
    if(!Number.isSafeInteger(cents)||cents<=0)throw new Error("Valor de reembolso inválido.");
    try{return (await createClient().post("/charges/"+encodeURIComponent(id)+"/cancel",{amount:{value:cents}},
        {headers:{"x-idempotency-key":key}})).data;}
    catch(error){throw buildPagSeguroError(error);}
}

async function criarCheckout(pedido, idempotencyKey) {
    const client = createClient();
    const payload = buildCheckoutPayload(pedido);

    try {
        const { data } = await client.post(
            "/checkouts",
            payload,
            idempotencyKey ? {headers:{"x-idempotency-key":idempotencyKey}} : undefined
        );

        return normalizarCheckout(data);
    } catch (error) {
        throw buildPagSeguroError(error);
    }
}

async function consultarCheckout(checkoutId) {
    if (!checkoutId) {
        const error = new Error("Informe o checkout do pagamento.");
        error.status = 400;
        throw error;
    }

    const client = createClient();

    try {
        const { data } = await client.get(
            `/checkouts/${encodeURIComponent(checkoutId)}`
        );

        return normalizarCheckout(data);
    } catch (error) {
        throw buildPagSeguroError(error);
    }
}

function buildCheckoutPayload(pedido) {
    const cliente = pedido.cliente || {};
    const items = Array.isArray(pedido.itens)
        ? pedido.itens
        : [];
    const appUrl = getAppUrl();
    const webhookUrl = `${appUrl}/api/public/pagamentos/webhook`;

    if (!items.length) {
        const error = new Error("O pedido não possui itens para pagamento.");
        error.status = 400;
        throw error;
    }

    return {
        reference_id: String(pedido.id),
        customer_modifiable: true,
        return_url: `${appUrl}/meus-pedidos`,
        redirect_url: `${appUrl}/meus-pedidos`,
        redirect_waiting_time: 5,
        notification_urls: [
            webhookUrl
        ],
        payment_notification_urls: [
            webhookUrl
        ],
        payment_methods: buildPaymentMethods(),
        expiration_date: pedido.reserva_expira_em ? new Date(pedido.reserva_expira_em).toISOString() : undefined,
        discount_amount: toCents(pedido.desconto),
        additional_amount: toCents(pedido.acrescimo),
        items: items.map(item => ({
            reference_id: String(item.produto_id || item.id || pedido.id),
            name: String(item.produto || "Produto PetFlow").slice(0, 100),
            quantity: Number(item.quantidade || 1),
            unit_amount: toCents(item.preco_unitario)
        })),
        customer: buildCustomer(cliente),
        shipping: {
            type: "FIXED",
            service_type: "PAC",
            amount: toCents(pedido.valor_frete),
            address: buildAddress(pedido.endereco_entrega || cliente),
            address_modifiable: false
        }
    };
}

function getAppUrl() {
    return String(APP_URL || "")
        .trim()
        .replace(/\/+$/g, "");
}

function buildPaymentMethods() {
    const methods = [
        {
            type: "PIX"
        },
        {
            type: "CREDIT_CARD"
        }
    ];
    if(process.env.PAGSEGURO_ENABLE_DEBIT==="true") methods.push({type:"DEBIT_CARD"});

    return methods;
}

function buildCustomer(cliente) {
    const customer = {
        name: normalizeText(cliente.nome || "Cliente PetFlow", 120),
        email: normalizeText(cliente.email, 60) || undefined
    };

    const phone = buildPhone(cliente);

    if (phone) {
        customer.phone = phone;
    }

    return customer;
}

function normalizarCheckout(data) {
    const payLink = Array.isArray(data?.links)
        ? data.links.find(link => link.rel === "PAY")
        : null;

    const charge = Array.isArray(data?.charges)
        ? data.charges[0]
        : null;

    const qrCode = Array.isArray(data?.qr_codes)
        ? data.qr_codes[0]
        : null;

    return {
        checkoutId: data?.id || null,
        orderId: data?.order_id || data?.reference_id || null,
        chargeId: charge?.id || null,
        status: charge?.status || data?.status || null,
        paymentMethod: mapPaymentMethod(
            charge?.payment_method?.type ||
            data?.payment_method?.type
        ),
        checkoutUrl: payLink?.href || null,
        qrCode: qrCode?.links?.[0]?.href || qrCode?.text || null,
        qrCodeText: qrCode?.text || null,
        raw: data || null
    };
}

function extrairEventoWebhook(body) {
    const referenceId =
        body?.reference_id ||
        body?.referenceId ||
        body?.checkout_id ||
        body?.checkoutId ||
        body?.id ||
        body?.charges?.[0]?.reference_id ||
        body?.charges?.[0]?.id;

    const pagseguroStatus =
        body?.charges?.[0]?.status ||
        body?.status ||
        body?.payment_status ||
        body?.paymentStatus ||
        null;

    return {
        referenceId,
        pagseguroStatus,
        orderId: body?.order_id || body?.id || null,
        chargeId: body?.charges?.[0]?.id || body?.charge_id || (/^CHAR_/.test(body?.id || "") ? body.id : null),
        paymentMethod: mapPaymentMethod(
            body?.charges?.[0]?.payment_method?.type ||
            body?.payment_method?.type ||
            body?.paymentMethod?.type ||
            body?.payment_method ||
            body?.paymentMethod
        ),
        vendaStatus: mapStatusToVenda(pagseguroStatus),
        raw: body
    };
}

function validarAssinaturaWebhook(payloadOriginal, assinaturaRecebida) {
    if (
        !PAGSEGURO_TOKEN ||
        !payloadOriginal ||
        !assinaturaRecebida
    ) {
        return false;
    }

    const assinatura = String(assinaturaRecebida).trim();
    if(!/^[a-f0-9]{64}$/i.test(assinatura)) return false;
    const hash = crypto
        .createHash("sha256")
        .update(`${PAGSEGURO_TOKEN}-${payloadOriginal}`, "utf8")
        .digest("hex");

    const expected = Buffer.from(hash, "hex");
    const received = Buffer.from(assinatura, "hex");

    if (expected.length !== received.length) {
        return false;
    }

    return crypto.timingSafeEqual(expected, received);
}

function mapStatusToVenda(status) {
    const normalized = String(status || "").trim().toUpperCase();

    if (
        [
            "PAID"
        ].includes(normalized)
    ) {
        return "PAGAMENTO_APROVADO";
    }

    if (
        [
            "CANCELED",
            "CANCELLED",
            "DECLINED",
            "REFUNDED",
            "CHARGEBACK",
            "CANCELADA"
            ,"EXPIRED"
        ].includes(normalized)
    ) {
        return "CANCELADA";
    }

    return "AGUARDANDO_PAGAMENTO";
}

function mapPaymentMethod(method) {
    const normalized = String(method || "").trim().toUpperCase();

    const methods = {
        PIX: "PIX",
        CREDIT_CARD: "CARTAO_CREDITO",
        DEBIT_CARD: "CARTAO_DEBITO",
        CARTAO_CREDITO: "CARTAO_CREDITO",
        CARTAO_DEBITO: "CARTAO_DEBITO"
    };

    return methods[normalized] || null;
}

function buildAddress(cliente) {
    return {
        country: "BRA",
        region_code: cliente.estado || "SP",
        city: cliente.cidade || "São Paulo",
        postal_code: onlyDigits(cliente.cep || "00000000"),
        street: cliente.endereco || "Endereço não informado",
        number: cliente.numero || "S/N",
        locality: cliente.bairro || "Bairro não informado",
        complement: cliente.complemento || undefined
    };
}

function buildPhone(cliente) {
    const phone = onlyDigits(
        cliente.whatsapp ||
        cliente.telefone ||
        ""
    );

    if (phone.length !== 11 || phone[2] !== "9") {
        return null;
    }

    return {
        country: "+55",
        area: phone.slice(0, 2),
        number: phone.slice(2),
        type: "MOBILE"
    };
}

function toCents(value) {
    return Math.max(0, Math.round(Number(value || 0) * 100));
}

function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
}

function normalizeText(value, maxLength) {
    return String(value || "")
        .trim()
        .slice(0, maxLength);
}

function buildPagSeguroError(error) {
    const payload = error.response?.data;
    const rawMessage =
        payload?.message ||
        payload?.error_messages?.[0]?.description ||
        payload?.errors?.[0]?.description ||
        "Não foi possível iniciar o pagamento no PagBank.";

    const customError = new Error(
        friendlyPagSeguroMessage(rawMessage)
    );
    customError.status = error.response?.status || 502;
    customError.details = payload;

    return customError;
}

function friendlyPagSeguroMessage(message) {
    const text = String(message || "");

    if (text.toLowerCase().includes("allowlist")) {
        return "O PagBank bloqueou o checkout porque essa conta ainda precisa de liberação para usar a API em produção. Entre em contato com o suporte do PagBank e solicite a liberação do Checkout/API.";
    }

    return text;
}

module.exports = {
    consultarChargeback,
    consultarCobranca,
    reembolsar,
    criarCheckout,
    consultarCheckout,
    extrairEventoWebhook,
    validarAssinaturaWebhook,
    mapStatusToVenda
};
