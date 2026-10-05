"use strict";

document.addEventListener("DOMContentLoaded", () => {
    enhanceStaticServiceCards();
    loadPublicCatalog();
    loadPublicServices();
    setupPublicSearch();
    setupCartCheckout();
    setupFavoritesPanel();
    setupCustomerNotifications();
    setupCustomerHeader();
    setupNewsletterForm();
});

const PUBLIC_API = "/api/public";

let publicProducts = [];
let publicCart = normalizeCartStorage();
let publicFavorites = new Set(JSON.parse(sessionStorage.getItem("petflow_public_favorites") || "[]"));
let publicCustomer = null;
let publicNotifications = [];
let currentSearchTerm = "";

async function loadPublicCatalog() {
    const grid = document.querySelector(".products-grid");

    if (!grid) {
        return;
    }

    try {
        const response = await fetch(`${PUBLIC_API}/produtos`);

        if (!response.ok) {
            throw new Error("Catálogo indisponível");
        }

        const payload = await response.json();
        publicProducts = Array.isArray(payload.data) ? payload.data : [];

        if (publicProducts.length) {
            applyPublicSearch(getSearchValue(), false);
            updateHeaderCounters();
            return;
        }

        publicProducts=[];grid.textContent="Nenhum produto disponível no momento.";updateHeaderCounters();
    } catch {
        publicProducts=[];grid.textContent="Não foi possível carregar os produtos. Tente novamente mais tarde.";updateHeaderCounters();
    }
}

async function loadPublicServices() {
    const grid = document.querySelector(".services-grid");

    if (!grid) {
        return;
    }

    try {
        const response = await fetch(`${PUBLIC_API}/servicos`);

        if (!response.ok) {
            throw new Error("Serviços indisponíveis");
        }

        const payload = await response.json();
        const services = Array.isArray(payload.data) ?payload.data : [];

        if (services.length) {
            renderServices(services.slice(0, 6));
        } else {grid.textContent="Nenhum serviço disponível no momento.";}
    } catch {
        grid.textContent="Não foi possível carregar os serviços. Tente novamente mais tarde.";
    }
}

function renderServices(services) {
    const grid = document.querySelector(".services-grid");

    if (!grid) {
        return;
    }

    grid.innerHTML = services.map(service => {
        const image = serviceImage(service.nome);
        const href = `/servicos/${serviceSlug(service.nome)}`;

        return `
            <article class="service-card">
                <a href="${escapeHtml(href)}" aria-label="Ver serviço ${escapeHtml(service.nome)}">
                    <img src="${escapeHtml(image)}" alt="${escapeHtml(service.nome)}" loading="lazy" decoding="async">
                    <h3>${escapeHtml(service.nome)}</h3>
                    <p>${escapeHtml(service.descricao || "Atendimento profissional para cuidar do bem-estar do seu pet.")}</p>
                    <div class="service-meta">
                        <strong>${currency(service.preco)}</strong>
                    </div>
                </a>
            </article>
        `;
    }).join("");
}

function enhanceStaticServiceCards() {
    document.querySelectorAll(".service-card").forEach(card => {
        if (card.querySelector("a")) {
            return;
        }

        const title = card.querySelector("h3")?.textContent;
        const slug = staticServiceSlug(title);

        if (!slug) {
            return;
        }

        const link = document.createElement("a");
        link.href = `/servicos/${slug}`;
        link.setAttribute("aria-label", `Ver serviço ${String(title || "").trim()}`);

        while (card.firstChild) {
            link.appendChild(card.firstChild);
        }

        card.appendChild(link);
    });
}

function staticServiceSlug(value) {
    const normalized = normalize(value);

    if (normalized === "tosa") return "tosa-completa";
    if (normalized.includes("veterin")) return "consulta-veterinaria";
    if (normalized.includes("banho")) return "banho";
    if (normalized.includes("vacin")) return "vacinacao";
    if (normalized.includes("hotel")) return "hotelzinho";

    return "";
}

function serviceImage(name) {
    const normalized = normalize(name);

    if (normalized.includes("higienica")) return "/images/services/tosa-higienica.jpg";
    if (normalized.includes("tosa")) return "/images/services/tosa.jpg";
    if (normalized.includes("consulta") || normalized.includes("veterin")) return "/images/services/veterinario.jpg";
    if (normalized.includes("vacina")) return "/images/services/vacinacao.jpg";
    if (normalized.includes("hotel")) return "/images/services/hotelzinho.jpg";
    if (normalized.includes("delivery")) return "/images/services/delivery.jpg";

    return "/images/services/banho-tosa.jpg";
}

function serviceSlug(value) {
    return normalize(value)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

function productSlug(product) {
    return normalize(product.sku || product.nome || product.id)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

function setupPublicSearch() {
    const form = document.querySelector(".search-form");
    const input = document.getElementById("search");

    if (!form || !input) {
        return;
    }

    form.addEventListener("submit", event => {
        event.preventDefault();
        applyPublicSearch(input.value, true);
    });

    input.addEventListener("input", () => {
        applyPublicSearch(input.value, false);
    });
}

function getSearchValue() {
    return document.getElementById("search")?.value || "";
}

function setupNewsletterForm() {
    const form = document.getElementById("newsletterForm");

    if (!form) {
        return;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const status = document.getElementById("newsletterStatus");
        const button = form.querySelector("button[type='submit']");
        const data = Object.fromEntries(new FormData(form).entries());

        setNewsletterStatus(status, "Enviando inscrição...");
        if (button) button.disabled = true;

        try {
            const response = await fetch(`${PUBLIC_API}/newsletter`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(data)
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload.message || "Não foi possível realizar a inscrição.");
            }

            form.reset();
            setNewsletterStatus(status, payload.message || "Inscrição realizada com sucesso.");
        } catch (error) {
            setNewsletterStatus(status, error.message || "Não foi possível realizar a inscrição.");
        } finally {
            if (button) button.disabled = false;
        }
    });
}

function setNewsletterStatus(element, message) {
    if (element) {
        element.textContent = message || "";
    }
}

function filterProducts(term) {
    const normalized = normalize(term);

    if (!normalized) {
        renderProducts(publicProducts.slice(0, 6));
        return;
    }

    const matches = publicProducts.filter(product => {
        return [
            product.nome,
            product.descricao,
            product.categoria,
            product.marca,
            product.fornecedor,
            product.sku
        ].some(value => normalize(value).includes(normalized));
    });

    renderProducts(matches, {
        emptyMessage: "Nenhum produto encontrado para essa busca."
    });
}

function applyPublicSearch(term, shouldScroll) {
    const normalized = normalize(term);
    currentSearchTerm = term || "";

    if (!normalized) {
        renderProducts(publicProducts.slice(0, 6));
        filterStaticCards(".category-card, .service-card", "");
        return;
    }

    filterProducts(term);
    filterStaticCards(".category-card, .service-card", normalized);

    if (shouldScroll) {
        document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
    }
}

function filterStaticCards(selector, normalizedTerm) {
    document.querySelectorAll(selector).forEach(card => {
        const text = normalize(card.textContent);
        card.hidden = Boolean(normalizedTerm) && !text.includes(normalizedTerm);
    });
}

function renderProducts(products, options = {}) {
    const grid = document.querySelector(".products-grid");

    if (!grid) {
        return;
    }

    if (!products.length) {
        grid.innerHTML = `<div class="public-empty">${options.emptyMessage || "Nenhum produto disponível no momento."}</div>`;
        return;
    }

    grid.innerHTML = products.map(product => {
        const id = product.id || product.sku || product.nome;
        const inCart = Boolean(publicCart[String(id)]);
        const favorite = publicFavorites.has(String(id));
        const href = `/produtos/${productSlug(product)}`;

        return `
            <article class="product-card" data-product-card data-id="${escapeHtml(id)}">
                <a class="product-link" href="${escapeHtml(href)}" aria-label="Ver produto ${escapeHtml(product.nome)}">
                    <img class="product-image" src="${escapeHtml(product.foto || "/images/products/petflow-prime-racao.jpg")}" alt="${escapeHtml(product.nome)}" loading="lazy" decoding="async">
                </a>
                <div class="product-content">
                    <span class="product-category">${escapeHtml(product.categoria || "PetFlow")}</span>
                    <h3 class="product-title"><a href="${escapeHtml(href)}">${escapeHtml(product.nome)}</a></h3>
                    <p class="product-description">${escapeHtml(product.descricao || "Produto selecionado para cuidar melhor do seu pet.")}</p>
                    <div class="product-footer">
                        <strong class="product-price">${currency(product.preco)}</strong>
                        <div class="cart-actions" aria-label="Ações da sacola">
                            <button class="cart-action add ${inCart ?"is-active" : ""}" type="button" data-action="toggle-cart">
                                <i class="fa-solid ${inCart ?"fa-check" : "fa-plus"}"></i>
                                <span>${inCart ?"Na sacola" : "Adicionar à sacola"}</span>
                            </button>
                            <button class="cart-action favorite ${favorite ?"is-active" : ""}" type="button" data-action="toggle-favorite">
                                <i class="fa-${favorite ?"solid" : "regular"} fa-heart"></i>
                                <span>${favorite ?"Favorito" : "Favoritar"}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    if (options.emptyMessage) {
        grid.insertAdjacentHTML("afterbegin", `<div class="public-empty">${escapeHtml(options.emptyMessage)}</div>`);
    }

    bindProductActions();
}

function bindProductActions() {
    document.querySelectorAll("[data-action='toggle-cart']").forEach(button => {
        if (button.dataset.boundAction === "true") {
            return;
        }

        button.dataset.boundAction = "true";
        button.addEventListener("click", () => {
            const id = button.closest("[data-product-card]")?.dataset.id;

            if (!id) {
                return;
            }

            toggleCartProduct(id);
            persistPublicState();
            syncProductButtons();
        });
    });

    document.querySelectorAll("[data-action='toggle-favorite']").forEach(button => {
        if (button.dataset.boundAction === "true") {
            return;
        }

        button.dataset.boundAction = "true";
        button.addEventListener("click", () => {
            const id = button.closest("[data-product-card]")?.dataset.id;

            if (!id) {
                return;
            }

            toggleSet(publicFavorites, id);
            persistPublicState();
            syncProductButtons();
        });
    });
}

function collectStaticProducts() {
    return [...document.querySelectorAll(".product-card")].map(card => {
        const name = card.querySelector(".product-title")?.textContent.trim();

        return {
            id: slugifyStaticProduct(name),
            nome: name,
            descricao: card.querySelector(".product-description")?.textContent.trim(),
            categoria: card.querySelector(".product-category")?.textContent.trim(),
            preco: card.querySelector(".product-price")?.textContent.replace(/[^\d,]/g, "").replace(",", "."),
            foto: card.querySelector(".product-image")?.getAttribute("src")
        };
    }).filter(item => item.nome);
}

function prepareStaticProductCards() {
    document.querySelectorAll(".product-card").forEach(card => {
        const title = card.querySelector(".product-title")?.textContent.trim();
        const id = slugifyStaticProduct(title);

        if (!id) {
            return;
        }

        card.dataset.productCard = "true";
        card.dataset.id = id;

        const addButton = card.querySelector(".cart-action.add");
        const favoriteButton = card.querySelector(".cart-action.favorite");

        if (addButton && !addButton.dataset.action) {
            addButton.dataset.action = "toggle-cart";
        }

        if (favoriteButton && !favoriteButton.dataset.action) {
            favoriteButton.dataset.action = "toggle-favorite";
        }
    });
}

function syncProductButtons() {
    document.querySelectorAll("[data-product-card]").forEach(card => {
        const id = card.dataset.id;
        const inCart = Boolean(publicCart[String(id)]);
        const favorite = publicFavorites.has(String(id));
        const cartButton = card.querySelector("[data-action='toggle-cart']");
        const favoriteButton = card.querySelector("[data-action='toggle-favorite']");

        if (cartButton) {
            cartButton.classList.toggle("is-active", inCart);
            cartButton.innerHTML = `
                <i class="fa-solid ${inCart ? "fa-check" : "fa-plus"}"></i>
                <span>${inCart ? "Na sacola" : "Adicionar à sacola"}</span>
            `;
        }

        if (favoriteButton) {
            favoriteButton.classList.toggle("is-active", favorite);
            favoriteButton.innerHTML = `
                <i class="fa-${favorite ? "solid" : "regular"} fa-heart"></i>
                <span>${favorite ? "Favorito" : "Favoritar"}</span>
            `;
        }
    });
}

function slugifyStaticProduct(value) {
    return normalize(value)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

function currentVisibleProducts() {
    const visibleIds = [...document.querySelectorAll("[data-product-card]")].map(card => card.dataset.id);
    const products = publicProducts.filter(product => visibleIds.includes(String(product.id || product.sku || product.nome)));

    if (products.length) {
        return products;
    }

    const normalized = normalize(currentSearchTerm);

    if (normalized) {
        return publicProducts.filter(product => {
            return [
                product.nome,
                product.descricao,
                product.categoria,
                product.marca,
                product.fornecedor,
                product.sku
            ].some(value => normalize(value).includes(normalized));
        });
    }

    return publicProducts.slice(0, 6);
}

function toggleSet(set, value) {
    if (set.has(String(value))) {
        set.delete(String(value));
        return;
    }

    set.add(String(value));
}

function toggleCartProduct(id) {
    const key = String(id);

    if (publicCart[key]) {
        delete publicCart[key];
        return;
    }

    publicCart[key] = 1;
}

function persistPublicState() {
    sessionStorage.setItem("petflow_public_cart", JSON.stringify(publicCart));
    sessionStorage.setItem("petflow_public_favorites", JSON.stringify([...publicFavorites]));
    updateHeaderCounters();
    renderFavoritesItems();
}

function updateHeaderCounters() {
    const cartCount = Object.values(publicCart).reduce((sum, quantity) => sum + Number(quantity || 0), 0);

    document.querySelectorAll("[aria-label='Sacola']").forEach(link => {
        link.dataset.count = String(cartCount);
        link.classList.toggle("has-count", cartCount > 0);
    });

    document.querySelectorAll("[aria-label='Favoritos'], .menu-action-link[aria-label='Abrir favoritos']").forEach(link => {
        link.dataset.count = String(publicFavorites.size);
        link.classList.toggle("has-count", publicFavorites.size > 0);
    });
}

function setupFavoritesPanel() {
    injectFavoritesPanel();

    document.querySelectorAll("[aria-label='Favoritos'], .menu-action-link[aria-label='Abrir favoritos']").forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            openFavoritesPanel();
        });
    });

    document.addEventListener("click", event => {
        if (event.target.closest("[data-favorites-close]")) {
            closeFavoritesPanel();
        }

        if (event.target.classList.contains("favorites-overlay")) {
            closeFavoritesPanel();
        }

        const remove = event.target.closest("[data-favorite-remove]");
        if (remove) {
            publicFavorites.delete(remove.dataset.favoriteRemove);
            persistPublicState();
            renderProducts(currentVisibleProducts());
        }

        const addCart = event.target.closest("[data-favorite-add-cart]");
        if (addCart) {
            publicCart[addCart.dataset.favoriteAddCart] = 1;
            persistPublicState();
            renderProducts(currentVisibleProducts());
        }
    });
}

function injectFavoritesPanel() {
    if (document.querySelector(".favorites-overlay")) {
        return;
    }

    document.body.insertAdjacentHTML("beforeend", `
        <div class="favorites-overlay" hidden>
            <aside class="favorites-panel" role="dialog" aria-modal="true" aria-labelledby="favoritesTitle">
                <header class="checkout-header">
                    <div>
                        <span>Favoritos</span>
                        <h2 id="favoritesTitle">Produtos salvos</h2>
                    </div>
                    <button class="icon-badge" type="button" data-favorites-close aria-label="Fechar favoritos">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </header>
                <div class="favorites-items" id="favoritesItems"></div>
            </aside>
        </div>
    `);
}

function openFavoritesPanel() {
    const overlay = document.querySelector(".favorites-overlay");

    if (!overlay) {
        return;
    }

    renderFavoritesItems();
    overlay.hidden = false;
    document.body.classList.add("favorites-open");
}

function closeFavoritesPanel() {
    const overlay = document.querySelector(".favorites-overlay");

    if (overlay) {
        overlay.hidden = true;
    }

    document.body.classList.remove("favorites-open");
}

function renderFavoritesItems() {
    const list = document.getElementById("favoritesItems");

    if (!list) {
        return;
    }

    const items = getFavoriteProducts();

    if (!items.length) {
        list.innerHTML = `
            <div class="public-empty">
                <strong>Nenhum favorito ainda.</strong>
                <p>Toque no coração dos produtos para salvar o que gostou.</p>
                <a class="btn btn-secondary" href="#products" data-favorites-close>Ver produtos</a>
            </div>
        `;
        return;
    }

    list.innerHTML = items.map(product => {
        const id = String(product.id || product.sku || product.nome);
        const inCart = Boolean(publicCart[id]);

        return `
            <article class="favorite-item">
                <img src="${escapeHtml(product.foto || "/images/products/petflow-prime-racao.jpg")}" alt="${escapeHtml(product.nome)}">
                <div>
                    <strong>${escapeHtml(product.nome)}</strong>
                    <span>${currency(product.preco)}</span>
                </div>
                <button class="cart-action add ${inCart ? "is-active" : ""}" type="button" data-favorite-add-cart="${escapeHtml(id)}">
                    <i class="fa-solid ${inCart ? "fa-check" : "fa-plus"}"></i>
                    <span>${inCart ? "Na sacola" : "Sacola"}</span>
                </button>
                <button class="icon-badge" type="button" data-favorite-remove="${escapeHtml(id)}" aria-label="Remover dos favoritos">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </article>
        `;
    }).join("");
}

function getFavoriteProducts() {
    return [...publicFavorites]
        .map(id => publicProducts.find(product => String(product.id || product.sku || product.nome) === String(id)))
        .filter(Boolean);
}

function setupCartCheckout() {
    document.querySelectorAll("[aria-label='Sacola'], .menu-action-link[aria-label='Abrir sacola']").forEach(link => {link.href="/sacola";});
    window.addEventListener("petflow:cart-updated",()=>{
        publicCart=normalizeCartStorage();updateHeaderCounters();syncProductButtons();
    });
}

function setupCustomerHeader() {
    const token = getCustomerToken();
    const cached = readCustomerCache();
    const firstName = getFirstName(cached?.nome);
    const fullName = String(cached?.nome || "Cliente").trim();
    const notificationButton = document.querySelector(".customer-notification-button");

    if (notificationButton) {
        notificationButton.hidden = !token;
    }

    document.querySelectorAll("[data-public-logout]").forEach(link => link.remove());

    document.querySelectorAll("a[href='/login'], a[href='/conta'], .menu-login-link").forEach(link => {
        if (token) {
            link.href = "/conta";
            link.textContent = firstName;
            link.title = fullName;
            link.classList.add("is-authenticated");
            link.setAttribute("aria-label", "Abrir minha conta");
            insertLogoutLink(link);
            return;
        }

        link.href = "/login";
        link.textContent = "Entrar";
        link.removeAttribute("title");
        link.classList.remove("is-authenticated");
        link.setAttribute("aria-label", "Entrar na conta");
    });

    if (token) {
        loadCustomerNotifications();
    } else {
        publicNotifications = [];
        renderCustomerNotifications();
    }
}

function setupCustomerNotifications() {
    ensureCustomerNotificationsPanel();

    const button = document.querySelector(".customer-notification-button");

    button?.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        const panel = document.querySelector(".customer-notification-panel");
        const willOpen = !panel?.classList.contains("active");

        panel?.classList.toggle("active", willOpen);
        button.setAttribute("aria-expanded", String(willOpen));

        if (willOpen) {
            await loadCustomerNotifications();
            await markCustomerNotificationsRead();
        }
    });

    document.addEventListener("click", event => {
        if (!event.target.closest(".customer-notification-wrap")) {
            closeCustomerNotifications();
        }
    });
}

function ensureCustomerNotificationsPanel() {
    const button = document.querySelector(".customer-notification-button");

    if (!button || button.closest(".customer-notification-wrap")) {
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "customer-notification-wrap";
    button.parentNode.insertBefore(wrapper, button);
    wrapper.appendChild(button);

    const panel = document.createElement("div");
    panel.className = "customer-notification-panel";
    panel.innerHTML = `
        <div class="customer-notification-header">
            <strong>Notificações</strong>
            <small id="customerNotificationStatus">Nenhuma nova</small>
        </div>
        <div class="customer-notification-list" id="customerNotificationList"></div>
    `;
    wrapper.appendChild(panel);
}

async function loadCustomerNotifications() {
    if (!getCustomerToken()) {
        return;
    }

    try {
        const response = await fetch(`${PUBLIC_API}/clientes/notificacoes`, {
            headers: {
                Authorization: `Bearer ${getCustomerToken()}`
            }
        });
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.message || "Não foi possível carregar notificações.");
        }

        publicNotifications = Array.isArray(payload.data) ? payload.data : [];
        renderCustomerNotifications();
    } catch {
        publicNotifications = [];
        renderCustomerNotifications();
    }
}

async function markCustomerNotificationsRead() {
    if (!getCustomerToken()) {
        return;
    }

    try {
        await fetch(`${PUBLIC_API}/clientes/notificacoes/lidas`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${getCustomerToken()}`
            }
        });

        publicNotifications = publicNotifications.map(item => ({
            ...item,
            lida: true
        }));
        renderCustomerNotifications();
    } catch {
        // A leitura pode ser tentada novamente na próxima abertura.
    }
}

function renderCustomerNotifications() {
    const button = document.querySelector(".customer-notification-button");
    const list = document.getElementById("customerNotificationList");
    const status = document.getElementById("customerNotificationStatus");

    if (!button || !list || !status) {
        return;
    }

    const unread = publicNotifications.filter(item => !item.lida).length;

    if (unread > 0) {
        button.dataset.count = String(unread);
    } else {
        delete button.dataset.count;
    }

    button.classList.toggle("has-count", unread > 0);
    status.textContent = unread > 0
        ? (unread === 1 ? "1 nova" : `${unread} novas`)
        : "Nenhuma nova";

    if (!publicNotifications.length) {
        list.innerHTML = `
            <div class="customer-notification-empty">
                Nenhuma notificação por enquanto.
            </div>
        `;
        return;
    }

    list.innerHTML = publicNotifications.map(item => `
        <article class="customer-notification-item ${item.lida ? "" : "is-unread"}">
            <i class="fa-regular fa-bell"></i>
            <div>
                <strong>${escapeHtml(item.titulo || "Notificação")}</strong>
                <p>${escapeHtml(item.mensagem || "")}</p>
                <small>${escapeHtml(formatNotificationDate(item.enviada_em))}</small>
            </div>
        </article>
    `).join("");
}

function closeCustomerNotifications() {
    const button = document.querySelector(".customer-notification-button");
    const panel = document.querySelector(".customer-notification-panel");

    panel?.classList.remove("active");
    button?.setAttribute("aria-expanded", "false");
}

function insertLogoutLink(accountLink) {
    const logout = document.createElement("a");
    logout.href = "#";
    logout.className = accountLink.classList.contains("menu-login-link")
        ? "menu-link public-logout-link"
        : "btn btn-secondary public-logout-link";
    logout.dataset.publicLogout = "true";
    logout.textContent = "Sair";
    logout.setAttribute("aria-label", "Sair da conta");
    logout.addEventListener("click", handleCustomerLogout);
    accountLink.insertAdjacentElement("afterend", logout);
}

async function handleCustomerLogout(event) {
    event.preventDefault();
    try { const response=await fetch(`${PUBLIC_API}/clientes/logout`,{method:"POST",headers:{Authorization:"Bearer "+getCustomerToken()}});if(!response.ok&&response.status!==401)throw new Error("Logout indisponível"); } catch { alert("Não foi possível encerrar a sessão. Tente novamente.");return; }
    clearCustomerSession();
    closeCustomerNotifications();
    setupCustomerHeader();
    syncProductButtons();
    renderFavoritesItems();
}

function clearCustomerSession() {
    sessionStorage.removeItem("petflow_customer_token");
    sessionStorage.removeItem("petflow_customer_user");
    sessionStorage.removeItem("petflow_public_favorites");
    sessionStorage.removeItem("petflow_public_cart");
    localStorage.removeItem("petflow_customer_token");
    localStorage.removeItem("petflow_customer_user");
    localStorage.removeItem("petflow_public_favorites");
    localStorage.removeItem("petflow_public_cart");
    publicCustomer = null;
    publicNotifications = [];
    publicFavorites = new Set();
    publicCart = {};
    updateHeaderCounters();
}

function getFirstName(name) {
    const firstName = String(name || "Cliente").trim().split(/\s+/)[0] || "Cliente";
    return firstName.length > 12 ? `${firstName.slice(0, 11)}...` : firstName;
}

async function fetchCustomerProfile() {
    const response = await fetch(`${PUBLIC_API}/clientes/me`, {
        headers: {
            Authorization: `Bearer ${getCustomerToken()}`
        }
    });
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.message || "Cliente não autenticado.");
    }

    sessionStorage.setItem("petflow_customer_user", JSON.stringify(payload.data));
    return payload.data;
}

function getCustomerToken() {
    return sessionStorage.getItem("petflow_customer_token");
}

function readCustomerCache() {
    try {
        return JSON.parse(sessionStorage.getItem("petflow_customer_user") || "null");
    } catch {
        return null;
    }
}

function hasDeliveryAddress(customer) {
    return Boolean(customer?.endereco && customer?.numero && customer?.bairro && customer?.cidade && customer?.estado);
}

function formatNotificationDate(value) {
    if (!value) {
        return "";
    }

    return new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}
function normalizeCartStorage() {
    try {
        const stored = JSON.parse(sessionStorage.getItem("petflow_public_cart") || "{}");

        if (Array.isArray(stored)) {
            return Object.fromEntries(stored.map(id => [String(id), 1]));
        }

        return stored && typeof stored === "object" ?stored : {};
    } catch {
        return {};
    }
}

function currency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function normalize(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
