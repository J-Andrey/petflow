"use strict";

const CUSTOMER_API = window.location.hostname === "localhost"
    ? "http://localhost:4500/api/public"
    : "/api/public";

document.addEventListener("DOMContentLoaded", () => {
    clearLegacyPublicSession();
    setupTabs();
    setupEmailVerificationFromUrl();
    setupPublicLogin();
    setupResendVerification();
    setupPublicRegister();
    setupPublicAccount();
    setupPublicOrders();
    setupCepLookup();
    setupCpfMasks();
    setupForgotPassword();
    setupPublicResetPassword();
    setupPasswordToggles();
});

document.addEventListener("petflow:customer-logout", () => {
    if (document.querySelector(".account-container")) {
        window.location.href = "/";
    }
});

function setupTabs() {
    document.querySelectorAll("[data-auth-tab]").forEach(button => {
        button.addEventListener("click", () => {
            const tab = button.dataset.authTab;
            const formId = tab === "login"
                ? "publicLoginForm"
                : "publicRegisterForm";

            document
                .querySelectorAll("[data-auth-tab]")
                .forEach(item => item.classList.toggle("active", item === button));

            document
                .querySelectorAll(".auth-panel")
                .forEach(panel => panel.classList.remove("active"));

            document.getElementById(formId)?.classList.add("active");
        });
    });
}

function setupPublicLogin() {
    const form = document.getElementById("publicLoginForm");

    form?.addEventListener("submit", async event => {
        event.preventDefault();
        const status = document.getElementById("loginStatus");
        setStatus(status, "Entrando...");

        try {
            const payload = await request(
                "/clientes/login",
                "POST",
                Object.fromEntries(new FormData(form).entries())
            );

            saveCustomer(payload.data);
            window.location.href = new URLSearchParams(location.search).get("retorno")==="sacola"?"/sacola":"/";
        } catch (error) {
            setStatus(status, error.message);
        }
    });
}

function setupPublicRegister() {
    const form = document.getElementById("publicRegisterForm");
    try { const address=JSON.parse(sessionStorage.getItem("petflow_delivery_address")||"null"); if(form&&address) Object.entries(address).forEach(([key,value])=>{if(form.elements[key])form.elements[key].value=value;}); } catch {}

    form?.addEventListener("submit", async event => {
        event.preventDefault();
        const status = document.getElementById("registerStatus");

        if (!validateCpfInput(form.elements.cpf, status)) {
            return;
        }

        setStatus(status, "Criando cadastro...");

        try {
            const payload = await request(
                "/clientes/cadastro",
                "POST",
                Object.fromEntries(new FormData(form).entries())
            );

            setStatus(status, payload.message || "Cadastro criado. Verifique seu e-mail para ativar a conta.");
            form.reset();
            document.querySelector("[data-auth-tab='login']")?.click();
        } catch (error) {
            setStatus(status, error.message);
        }
    });
}

async function setupEmailVerificationFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("verificar_email");

    if (!token) {
        return;
    }

    const status = document.getElementById("loginStatus");
    setStatus(status, "Confirmando seu e-mail...");

    try {
        const payload = await request(
            `/clientes/verificar-email?token=${encodeURIComponent(token)}`,
            "GET"
        );

        setStatus(status, payload.message || "E-mail confirmado com sucesso. Você já pode entrar.");
        window.history.replaceState({}, document.title, "/login");
    } catch (error) {
        setStatus(status, error.message || "Não foi possível confirmar o e-mail.");
    }
}

async function setupPublicAccount() {
    const form = document.getElementById("publicAccountForm");

    if (!form) {
        return;
    }

    const token = getCustomerToken();

    if (!token) {
        window.location.href = "/login";
        return;
    }

    const status = document.getElementById("accountStatus");

    try {
        const payload = await request("/clientes/me", "GET");
        fillForm(form, payload.data);
        sessionStorage.setItem("petflow_customer_user", JSON.stringify(payload.data));
        window.PetFlowPublicHeader?.update();
    } catch {
        clearPublicSession();
        window.location.href = "/login";
        return;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();

        if (!validateCpfInput(form.elements.cpf, status)) {
            return;
        }

        setStatus(status, "Salvando...");

        try {
            const payload = await request(
                "/clientes/me",
                "PUT",
                Object.fromEntries(new FormData(form).entries())
            );

            sessionStorage.setItem("petflow_customer_user", JSON.stringify(payload.data));
            window.PetFlowPublicHeader?.update();
            sessionStorage.removeItem("petflow_delivery_address");
            setStatus(status, "Dados atualizados com sucesso.");
        } catch (error) {
            setStatus(status, error.message);
        }
    });

    document.getElementById("publicLogout")?.addEventListener("click", async () => {
        try { await request("/clientes/logout", "POST", {}); } catch(error) { setStatus(status,error.message); return; }
        clearPublicSession();
        window.location.href = "/";
    });

    document.getElementById("publicDeleteAccount")?.addEventListener("click", async () => {
        const confirmed = window.confirm(
            "Tem certeza que deseja excluir seu cadastro? Você perderá o acesso à área do cliente."
        );

        if (!confirmed) {
            return;
        }

        setStatus(status, "Excluindo cadastro...");

        try {
            const result = await request("/clientes/me", "DELETE");
            clearPublicSession();
            setStatus(status, result.message);
            form.querySelectorAll("input, button").forEach(element => element.disabled = true);
        } catch (error) {
            setStatus(status, error.message || "Não foi possível excluir o cadastro.");
        }
    });
}

function clearPublicSession() {
    sessionStorage.removeItem("petflow_customer_token");
    sessionStorage.removeItem("petflow_customer_user");
    sessionStorage.removeItem("petflow_public_favorites");
    sessionStorage.removeItem("petflow_public_cart");
    clearLegacyPublicSession();
    window.PetFlowPublicHeader?.update();
}

function clearLegacyPublicSession() {
    localStorage.removeItem("petflow_customer_token");
    localStorage.removeItem("petflow_customer_user");
    localStorage.removeItem("petflow_public_favorites");
    localStorage.removeItem("petflow_public_cart");
}

async function setupPublicOrders() {
    const list = document.getElementById("publicOrdersList");

    if (!list) {
        return;
    }

    const token = getCustomerToken();

    if (!token) {
        window.location.href = "/login";
        return;
    }

    const status = document.getElementById("ordersStatus");

    list.addEventListener("click", event => {
        const button = event.target.closest("[data-continue-payment]");

        if (!button) {
            return;
        }

        window.location.href = button.dataset.continuePayment;
    });

    try {
        const payload = await request("/clientes/pedidos", "GET");
        renderOrders(list, Array.isArray(payload.data) ? payload.data : []);
        setStatus(status, "");
    } catch (error) {
        setStatus(status, error.message || "Não foi possível carregar seus pedidos.");
    }
}

function renderOrders(list, orders) {
    if (!orders.length) {
        list.innerHTML = `
            <div class="orders-empty">
                <i class="fa-regular fa-folder-open"></i>
                <strong>Você ainda não fez pedidos.</strong>
                <span>Quando comprar pela sacola, seus pedidos aparecerão aqui.</span>
            </div>
        `;

        return;
    }

    list.innerHTML = orders.map(order => {
        const items = Array.isArray(order.itens)
            ? order.itens
            : [];

        return `
            ${order.status === "SAIU_PARA_ENTREGA" ? `<a class="btn-secondary" href="/entrega.html?pedido=${encodeURIComponent(order.id)}">Rastrear pedido</a>` : ""}
            <article class="order-card">
                <header>
                    <div>
                        <span>Pedido #${escapeHtml(shortId(order.id))}</span>
                        <strong>${escapeHtml(formatStatus(order.status))}</strong>
                    </div>

                    <b>${currency(order.valor_final ?? order.valor_total)}</b>
                </header>

                <dl>
                    <div>
                        <dt>Data</dt>
                        <dd>${formatDate(order.data_venda)}</dd>
                    </div>

                    <div>
                        <dt>Pagamento</dt>
                        <dd>${escapeHtml(formatPaymentMethod(order.forma_pagamento))}</dd>
                    </div>

                    <div>
                        <dt>Entrega</dt>
                        <dd>${escapeHtml(formatOrderAddress(order))}</dd>
                    </div>
                </dl>

                <ul>
                    ${items.map(item => `
                        <li>
                            <span>${escapeHtml(item.produto || "Produto")}</span>
                            <strong>${Number(item.quantidade || 0)} x ${currency(item.preco_unitario)}</strong>
                        </li>
                    `).join("")}
                </ul>

                ${renderOrderNotes(order)}
                ${renderOrderTimeline(order.status)}
                ${renderContinuePayment(order)}
            </article>
        `;
    }).join("");
}

function renderOrderNotes(order) {
    if (!order.observacoes) {
        return "";
    }

    return `
        <div class="order-note">
            <span>Observações</span>
            <p>${escapeHtml(order.observacoes)}</p>
        </div>
    `;
}

function renderContinuePayment(order) {
    if (
        order.status !== "AGUARDANDO_PAGAMENTO" ||
        !order.pagseguro_checkout_url
    ) {
        return "";
    }

    return `
        <div class="order-actions">
            <button
                class="btn order-pay-button"
                type="button"
                data-continue-payment="${escapeHtml(order.pagseguro_checkout_url)}"
            >
                <i class="fa-solid fa-lock"></i>
                Continuar pagamento
            </button>
            <span>Você será direcionado para o ambiente seguro do PagBank.</span>
        </div>
    `;
}

function renderOrderTimeline(status) {
    const steps = [
        {
            status: "AGUARDANDO_PAGAMENTO",
            label: "Pedido criado"
        },
        {
            status: "PAGAMENTO_APROVADO",
            label: "Pedido recebido"
        },
        {
            status: "EM_SEPARACAO",
            label: "Preparando"
        },
        {
            status: "SAIU_PARA_ENTREGA",
            label: "Saiu para entrega"
        },
        {
            status: "ENTREGUE",
            label: "Entregue"
        }
    ];

    const currentIndex = Math.max(
        0,
        steps.findIndex(step => step.status === status)
    );

    return `
        <ol class="order-timeline" aria-label="Andamento do pedido">
            ${steps.map((step, index) => `
                <li class="${index <= currentIndex ? "is-done" : ""}">
                    <span>${index <= currentIndex ? "✓" : ""}</span>
                    ${escapeHtml(step.label)}
                </li>
            `).join("")}
        </ol>
    `;
}

function formatStatus(status) {
    const labels = {
        PENDENTE: "Pendente",
        APROVADO: "Aprovado",
        AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
        PAGAMENTO_APROVADO: "Pedido recebido",
        EM_SEPARACAO: "Preparando",
        EM_ENTREGA: "Em entrega",
        SAIU_PARA_ENTREGA: "Saiu para entrega",
        ENTREGUE: "Entregue",
        FINALIZADA: "Finalizado",
        CONCLUIDO: "Concluído",
        CANCELADO: "Cancelado",
        CANCELADA: "Cancelada"
    };

    return labels[status] || status || "Pendente";
}

function formatPaymentMethod(value) {
    const labels = {
        PIX: "PIX",
        CARTAO_CREDITO: "Cartão de crédito",
        CARTAO_DEBITO: "Cartão de débito",
        PAGBANK: "Aguardando pagamento",
        CREDIT_CARD: "Cartão de crédito",
        DEBIT_CARD: "Cartão de débito",
        BOLETO: "Boleto"
    };

    return labels[value] || value || "Não informado";
}

function formatOrderAddress(order) {
    return [
        order.endereco,
        order.numero,
        order.complemento,
        order.bairro,
        order.cidade,
        order.estado
    ].filter(Boolean).join(", ") || "Endereço não informado";
}

function shortId(id) {
    return String(id || "").slice(0, 8).toUpperCase();
}

function formatDate(value) {
    if (!value) {
        return "Não informado";
    }

    return new Date(value).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

function currency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function setupCepLookup() {
    document.querySelectorAll("input[name='cep']").forEach(input => {
        let lookupTimer = null;
        let lastLoadedCep = "";

        const lookup = async () => {
            const cep = input.value.replace(/\D/g, "");

            if (cep.length !== 8 || cep === lastLoadedCep) {
                return;
            }

            try {
                const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                const data = await response.json();

                if (data.erro) {
                    return;
                }

                lastLoadedCep = cep;
                const form = input.closest("form");
                setField(form, "endereco", data.logradouro);
                setField(form, "bairro", data.bairro);
                setField(form, "cidade", data.localidade);
                setField(form, "estado", data.uf);
                form?.elements.numero?.focus();
            } catch {
                // CEP manual continua permitido.
            }
        };

        input.addEventListener("input", () => {
            const digits = input.value.replace(/\D/g, "").slice(0, 8);
            input.value = digits.length > 5
                ? `${digits.slice(0, 5)}-${digits.slice(5)}`
                : digits;

            window.clearTimeout(lookupTimer);
            lookupTimer = window.setTimeout(lookup, 350);
        });

        input.addEventListener("blur", lookup);
    });
}

function setupCpfMasks() {
    document.querySelectorAll("input[name='cpf']").forEach(input => {
        input.addEventListener("input", () => {
            const digits = input.value.replace(/\D/g, "").slice(0, 11);
            input.value = formatCpf(digits);
        });

        input.addEventListener("blur", () => {
            validateCpfInput(input, document.getElementById("accountStatus") || document.getElementById("registerStatus"));
        });
    });
}

function validateCpfInput(input, status) {
    if (!input) {
        return true;
    }

    const digits = input.value.replace(/\D/g, "");

    if (!/^\d{11}$/.test(digits)) {
        setStatus(status, "Informe um CPF válido com 11 números.");
        input.focus();
        return false;
    }

    input.value = formatCpf(digits);
    setStatus(status, "");
    return true;
}

function formatCpf(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 11);

    if (digits.length > 9) {
        return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
    }

    if (digits.length > 6) {
        return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    }

    if (digits.length > 3) {
        return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    }

    return digits;
}

function setupForgotPassword() {
    document
        .querySelector("[data-public-forgot-password]")
        ?.addEventListener("click", async event => {
            event.preventDefault();
            const status = document.getElementById("loginStatus");
            const email = document.getElementById("loginEmail")?.value?.trim();

            if (!email) {
                setStatus(status, "Informe seu e-mail para receber o link de recuperação.");
                return;
            }

            setStatus(status, "Enviando e-mail de recuperação...");

            try {
                const payload = await request(
                    "/clientes/esqueci-senha",
                    "POST",
                    { email }
                );

                setStatus(status, payload.message || "Verifique seu e-mail.");
            } catch (error) {
                setStatus(status, error.message || "Não foi possível enviar o e-mail.");
            }
        });
}

function setupPublicResetPassword() {
    const form = document.getElementById("publicResetPasswordForm");

    if (!form) {
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") || "";
    const isAdminReset = params.get("tipo") === "admin";
    const status = document.getElementById("resetStatus");
    const tokenInput = document.getElementById("resetToken");

    if (isAdminReset) {
        setText(document.querySelector(".login-eyebrow"), "Área administrativa");
        setText(document.getElementById("resetTitle"), "Crie uma nova senha administrativa");
    }

    if (tokenInput) {
        tokenInput.value = token;
    }

    if (!token) {
        setStatus(status, "Link inválido. Solicite uma nova recuperação de senha.");
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const senha = form.senha.value;
        const senhaConfirmacao = form.senhaConfirmacao.value;

        if (senha !== senhaConfirmacao) {
            setStatus(status, "As senhas não conferem.");
            return;
        }

        setStatus(status, "Salvando nova senha...");

        try {
            await requestPasswordReset(params.get("tipo"), {
                token,
                senha
            });

            setStatus(status, "Senha redefinida com sucesso. Você já pode entrar.");
            setTimeout(() => {
                window.location.href = isAdminReset
                    ? "/admin/index.html"
                    : "/login";
            }, 1500);
        } catch (error) {
            setStatus(status, error.message || "Não foi possível redefinir a senha.");
        }
    });
}

async function requestPasswordReset(type, body) {
    if (type !== "admin") {
        return request("/clientes/redefinir-senha", "POST", body);
    }

    const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.message || `Erro ${response.status}`);
    }

    return payload;
}

async function request(endpoint, method = "GET", body) {
    const token = getCustomerToken();
    const response = await fetch(`${CUSTOMER_API}${endpoint}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });

    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.message || `Erro ${response.status}`);
    }

    return payload;
}

function saveCustomer(data) {
    clearLegacyPublicSession();
    sessionStorage.setItem("petflow_customer_token", data.token);
    sessionStorage.setItem("petflow_customer_user", JSON.stringify(data.user));
    window.PetFlowPublicHeader?.update();
}

function getCustomerToken() {
    return sessionStorage.getItem("petflow_customer_token");
}

function fillForm(form, data) {
    Object.entries(data || {}).forEach(([key, value]) => {
        if (form.elements[key]) {
            form.elements[key].value = form.elements[key].type === "date" && value
                ? String(value).slice(0, 10)
                : value || "";
        }
    });
}

function setField(form, name, value) {
    if (form?.elements[name]) {
        form.elements[name].value = value || "";
    }
}

function setText(element, message) {
    if (element) {
        element.textContent = message || "";
    }
}

function setStatus(element, message) {
    if (element) {
        element.textContent = message || "";
    }
}

function setupPasswordToggles() {
    document.querySelectorAll("input[type='password']").forEach(input => {
        if (input.closest(".password-control")) {
            return;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "password-control";
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const button = document.createElement("button");
        button.className = "password-toggle";
        button.type = "button";
        button.setAttribute("aria-label", "Mostrar senha");
        button.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';

        button.addEventListener("click", () => {
            const visible = input.type === "text";
            input.type = visible ? "password" : "text";
            button.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
            button.innerHTML = visible
                ? '<i class="fa-regular fa-eye-slash"></i>'
                : '<i class="fa-regular fa-eye"></i>';
        });

        wrapper.appendChild(button);
    });
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function setupResendVerification() {
    const form = document.getElementById("publicLoginForm");
    if (!form) return;
    const button=document.createElement("button");
    button.type="button"; button.className="btn"; button.textContent="Reenviar confirmação de e-mail";
    form.appendChild(button);
    button.addEventListener("click",async()=>{
        button.disabled=true;
        try {
            const result=await request("/clientes/reenviar-confirmacao","POST",{email:form.elements.email.value});
            setStatus(document.getElementById("loginStatus"),result.message);
        } catch(error) { setStatus(document.getElementById("loginStatus"),error.message); }
        finally { button.disabled=false; }
    });
}
