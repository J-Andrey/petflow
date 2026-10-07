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
        error.paymentError = true;
        error.checkoutRejected = true;
        error.paymentErrorCode = "payment_not_configured";
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
            `/checkouts/${encodeURIComponent(checkoutId)}`,
            { params: { limit: 100 } }
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
    let origin;
    try { origin = new URL(appUrl); } catch { rejectBeforeCheckout("Configure o endereço da loja para iniciar o pagamento.", "invalid_app_url", 503); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash)
        rejectBeforeCheckout("Confira o endereço configurado da loja para iniciar o pagamento.", "invalid_app_url", 503);
    const webhookUrl = `${appUrl}/api/public/pagamentos/webhook`;

    if (!items.length) {
        rejectBeforeCheckout("O pedido não possui itens para pagamento.", "invalid_order_items");
    }

    if (webhookUrl.length > 100 || `${appUrl}/meus-pedidos`.length > 255)
        rejectBeforeCheckout("O endereço da loja excede o limite aceito pelo PagBank. Confira a configuração.", "invalid_app_url", 503);
    const paymentItems = items.map(item => {
        const quantity = Number(item.quantidade);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
            rejectBeforeCheckout("A quantidade de um produto excede o limite de pagamento. Procure o atendimento.", "invalid_quantity");
        return { reference_id: String(item.produto_id || item.id || pedido.id), name: normalizeText(item.produto || item.produto_nome || "Produto PetFlow", 100), quantity, unit_amount: toCents(item.preco_unitario) };
    });
    const discount = toCents(pedido.desconto), extra = toCents(pedido.acrescimo), shipping = toCents(pedido.valor_frete);
    const subtotal = paymentItems.reduce((total, item) => total + item.quantity * item.unit_amount, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal > 999999900 || discount > subtotal + extra || subtotal - discount + extra + shipping <= 0)
        rejectBeforeCheckout("Confira os valores e descontos do pedido antes de pagar.", "invalid_order_total");
    if (pedido.valor_final != null && subtotal - discount + extra + shipping !== toCents(pedido.valor_final))
        rejectBeforeCheckout("O total do pedido diverge dos produtos e do frete. Procure o atendimento.", "invalid_order_total");

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
        discount_amount: discount,
        additional_amount: extra,
        items: paymentItems,
        customer: buildCustomer(cliente),
        shipping: {
            type: shipping ? "FIXED" : "FREE",
            amount: shipping,
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
        name: normalizeText(cliente.nome, 120) || undefined,
        email: normalizeText(cliente.email, 60) || undefined,
        tax_id: onlyDigits(cliente.cpf || cliente.cnpj) || undefined
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

    const candidates = [];
    if (Array.isArray(data?.charges)) data.charges.forEach(charge => candidates.push({ charge, orderId: data.order_id || (/^ORDE_/.test(data.id || "") ? data.id : null) }));
    for (const order of [...(Array.isArray(data?.orders) ? data.orders : []), ...(Array.isArray(data?.payments) ? data.payments : [])]) {
        if (Array.isArray(order.charges)) order.charges.forEach(charge => candidates.push({ charge, orderId: order.id }));
    }
    candidates.sort((a, b) => (b.charge.status === "PAID") - (a.charge.status === "PAID") || (new Date(b.charge.created_at).getTime() || 0) - (new Date(a.charge.created_at).getTime() || 0));
    const selected = candidates[0], charge = selected?.charge;

    const qrCode = Array.isArray(data?.qr_codes)
        ? data.qr_codes[0]
        : null;

    return {
        checkoutId: data?.id || null,
        orderId: selected?.orderId || data?.order_id || null,
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
        orderId: body?.order_id || (/^ORDE_/.test(body?.id || "") ? body.id : null),
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
        number: phone.slice(2)
    };
}

function toCents(value) {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? 0));
    if (!match) rejectBeforeCheckout("O pedido contém um valor monetário inválido.", "invalid_amount");
    const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    if (!Number.isSafeInteger(cents) || cents > 999999900) rejectBeforeCheckout("O valor do pedido excede o limite de pagamento.", "invalid_amount");
    return cents;
}
function rejectBeforeCheckout(message, code, status = 400) {
    throw Object.assign(new Error(message), { status, paymentError: true, checkoutRejected: true, paymentErrorCode: code });
}
function validateCheckout(order) { assertConfigured(); return buildCheckoutPayload(order); }

function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
}

function normalizeText(value, maxLength) {
    return String(value || "")
        .trim()
        .slice(0, maxLength);
}

function buildPagSeguroError(error) {
    if (error.paymentError) return error;
    const payload = error.response?.data;
    const problem = payload?.error_messages?.[0] || payload?.errors?.[0] || {};
    const code = /^[a-zA-Z0-9_]{1,80}$/.test(problem.error || problem.code || "") ? problem.error || problem.code : "payment_provider_error";
    const providerStatus = Number(error.response?.status || 0);
    const rejected = [400,401,403,404,406,415,422].includes(providerStatus) && !/^CHEC_/.test(payload?.id || "");
    const names = { "customer.name": "nome completo", "customer.email": "e-mail", "customer.tax_id": "CPF", "customer.phone": "celular", "shipping.address": "endereço de entrega", "shipping.address.postal_code": "CEP", "shipping.address.number": "número do endereço", "shipping.address.locality": "bairro", "shipping.address.city": "cidade", "shipping.address.region_code": "estado" };
    let message;
    if (code === "allowlist_access_required") message = "O PagBank recusou o checkout porque a conta da loja ainda precisa de liberação para usar a API em produção. Contate o PagBank para liberar Checkout/API.";
    else if (providerStatus === 401 || code === "invalid_authorization_header") message = "O PagBank recusou a credencial de pagamento da loja. A administração precisa conferir o token de produção configurado.";
    else if (providerStatus === 403 || code === "access_denied") message = "O PagBank não autorizou esta conta a iniciar o pagamento. A administração precisa conferir a liberação da API de Checkout em produção.";
    else if (names[problem.parameter_name]) message = "O PagBank recusou o " + names[problem.parameter_name] + ". Confira os dados em Minha conta ou no endereço de entrega e tente pagar este mesmo pedido.";
    else if (rejected) message = "O PagBank recusou os dados do pagamento. O pedido continua salvo; confira seus dados e tente novamente em Meus pedidos.";
    else message = "Não foi possível confirmar a resposta do PagBank. O pedido está salvo; consulte Meus pedidos ou o atendimento antes de tentar outra compra.";
    return Object.assign(new Error(message), { status: providerStatus === 401 || providerStatus === 403 ? 503 : rejected ? 400 : 502, paymentError: true, paymentErrorCode: code, checkoutRejected: rejected });
}

module.exports = {
    validateCheckout,
    consultarChargeback,
    consultarCobranca,
    reembolsar,
    criarCheckout,
    consultarCheckout,
    extrairEventoWebhook,
    validarAssinaturaWebhook,
    mapStatusToVenda
};
