"use strict";

(function setupPetFlowPublicHeader() {
    const HEADER_VERSION = "20260811-1";

    document.addEventListener("DOMContentLoaded", initPublicHeader);

    window.PetFlowPublicHeader = {
        init: initPublicHeader,
        update: updateHeaderState,
        clearSession: clearCustomerSession
    };

    function initPublicHeader() {
        if(!document.querySelector("script[data-cart-sidebar]")){
            const script=document.createElement("script");script.src="/js/layout/cart-sidebar.js";script.dataset.cartSidebar="true";document.body.append(script);
        }
        ensureHeader();
        setupHeaderSearch();
        setupMenuToggle();
        updateHeaderState();
    }

    function ensureHeader() {
        if (document.querySelector(".public-header")) {
            return;
        }

        const oldTopbar = document.querySelector(".category-topbar, .product-topbar, .service-topbar, .cart-topbar");

        if (oldTopbar) {
            oldTopbar.remove();
        }

        document.body.insertAdjacentHTML("afterbegin", headerTemplate());
    }

    function headerTemplate() {
        return `
            <header class="header public-header" data-public-header="${HEADER_VERSION}">
                <div class="container">
                    <a class="logo" href="/#hero" aria-label="Ir para a página inicial">
                        <img src="/images/logo/fred-petflow-logo-transparent.png" alt="Logo da PetFlow" width="60" height="60">
                        <span class="logo-text">PetFlow</span>
                    </a>

                    <form class="search-form" data-public-header-search role="search" aria-label="Pesquisar produtos" autocomplete="off">
                        <label class="sr-only" for="publicHeaderSearch">Pesquisar produtos</label>
                        <input
                            class="form-control"
                            type="search"
                            id="publicHeaderSearch"
                            name="search"
                            placeholder="Buscar produtos e serviços"
                            maxlength="100"
                            aria-label="Pesquisar produtos">
                        <button class="search-button" type="submit" aria-label="Pesquisar"></button>
                    </form>

                    <nav class="menu" id="menu" aria-label="Menu principal">
                        <ul class="menu-list">
                            <li class="menu-item">
                                <a href="/#hero" class="menu-link" data-public-nav="home">Início</a>
                            </li>
                            <li class="menu-item">
                                <a href="/#categories" class="menu-link" data-public-nav="categories">Categorias</a>
                            </li>
                            <li class="menu-item">
                                <a href="/#products" class="menu-link" data-public-nav="products">Produtos</a>
                            </li>
                            <li class="menu-item">
                                <a href="/#services" class="menu-link" data-public-nav="services">Serviços</a>
                            </li>
                            <li class="menu-item">
                                <a href="/#newsletter" class="menu-link" data-public-nav="contact">Contato</a>
                            </li>
                            <li class="menu-item menu-login-item">
                                <a href="/login" class="menu-link menu-login-link">Entrar</a>
                            </li>
                            <li class="menu-item menu-actions-item">
                                <a href="/#products" class="menu-action-link" aria-label="Abrir favoritos">
                                    <i class="fa-regular fa-heart"></i>
                                    Favoritos
                                </a>
                                <a href="/sacola" class="menu-action-link" aria-label="Abrir sacola">
                                    <i class="fa-solid fa-bag-shopping"></i>
                                    Sacola
                                </a>
                            </li>
                        </ul>
                    </nav>

                    <div class="header-actions">
                        <button
                            class="icon-badge customer-notification-button"
                            type="button"
                            aria-label="Notificações"
                            aria-expanded="false"
                            hidden>
                            <i class="fa-regular fa-bell"></i>
                        </button>

                        <a href="/#products" class="icon-badge" aria-label="Favoritos">
                            <i class="fa-regular fa-heart"></i>
                        </a>

                        <a href="/sacola" class="icon-badge" aria-label="Sacola">
                            <i class="fa-solid fa-bag-shopping"></i>
                        </a>

                        <a href="/login" class="btn btn-primary">Entrar</a>

                        <button
                            class="menu-toggle"
                            type="button"
                            aria-label="Abrir menu"
                            aria-controls="menu"
                            aria-expanded="false">
                        </button>
                    </div>
                </div>
            </header>
        `;
    }

    function setupHeaderSearch() {
        const form = document.querySelector("[data-public-header-search]");
        const input = document.getElementById("publicHeaderSearch");

        if (!form || form.dataset.publicHeaderBound === "true") {
            return;
        }

        form.dataset.publicHeaderBound = "true";
        form.addEventListener("submit", event => {
            event.preventDefault();

            const query = String(input?.value || "").trim();
            const categorySearch = document.getElementById("categorySearch");

            if (categorySearch) {
                categorySearch.value = query;
                categorySearch.dispatchEvent(new Event("input", { bubbles: true }));
                return;
            }

            window.location.href = query
                ? `/#products?busca=${encodeURIComponent(query)}`
                : "/#products";
        });
    }

    function setupMenuToggle() {
        const button = document.querySelector(".public-header .menu-toggle");
        const menu = document.getElementById("menu");

        if (!button || button.dataset.publicHeaderBound === "true") {
            return;
        }

        button.dataset.publicHeaderBound = "true";
        button.addEventListener("click", () => {
            const willOpen = !menu?.classList.contains("active");

            menu?.classList.toggle("active", willOpen);
            button.setAttribute("aria-expanded", String(willOpen));
            button.setAttribute("aria-label", willOpen ? "Fechar menu" : "Abrir menu");
        });
    }

    function updateHeaderState() {
        updateActiveLink();
        updateCustomerLinks();
        updateHeaderCounters();
    }

    function updateActiveLink() {
        const path = window.location.pathname;

        document.querySelectorAll(".public-header .menu-link").forEach(link => {
            link.classList.remove("active");
        });

        if (path.startsWith("/categorias")) {
            setActive("categories");
        } else if (path.startsWith("/produtos")) {
            setActive("products");
        } else if (path.startsWith("/servicos")) {
            setActive("services");
        } else if (path === "/") {
            setActive("home");
        }
    }

    function setActive(name) {
        document.querySelector(`.public-header [data-public-nav="${name}"]`)?.classList.add("active");
    }

    function updateCustomerLinks() {
        const token = getCustomerToken();
        const cached = readCustomerCache();
        const firstName = getFirstName(cached?.nome);
        const fullName = String(cached?.nome || "Cliente").trim();
        const notificationButton = document.querySelector(".public-header .customer-notification-button");

        if (notificationButton) {
            notificationButton.hidden = !token;
        }

        document.querySelectorAll(".public-header [data-public-logout]").forEach(link => link.remove());

        document.querySelectorAll(".public-header a[href='/login'], .public-header a[href='/conta'], .public-header .menu-login-link").forEach(link => {
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
    }

    function insertLogoutLink(accountLink) {
        const logout = document.createElement("a");
        logout.href = "#";
        logout.className = accountLink.classList.contains("menu-login-link")
            ? "menu-link public-logout-link"
            : "btn public-logout-link";
        logout.dataset.publicLogout = "true";
        logout.textContent = "Sair";
        logout.setAttribute("aria-label", "Sair da conta");
        logout.addEventListener("click", handleCustomerLogout);
        accountLink.insertAdjacentElement("afterend", logout);
    }

    async function handleCustomerLogout(event) {
        event.preventDefault();
        try {
            const response = await fetch("/api/public/clientes/logout", {method:"POST",headers:{Authorization:"Bearer "+sessionStorage.getItem("petflow_customer_token")}});
            if (!response.ok && response.status !== 401) throw new Error("Não foi possível encerrar a sessão.");
        } catch { window.alert("Não foi possível encerrar a sessão. Tente novamente."); return; }
        clearCustomerSession();
        updateHeaderState();
        document.dispatchEvent(new CustomEvent("petflow:customer-logout"));
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
    }

    function updateHeaderCounters() {
        const cart = readJson("petflow_public_cart", {});
        const favorites = readJson("petflow_public_favorites", []);
        const cartCount = Object.values(cart).reduce((sum, quantity) => sum + Number(quantity || 0), 0);
        const favoritesCount = Array.isArray(favorites) ? favorites.length : 0;

        document.querySelectorAll(".public-header [aria-label='Sacola'], .public-header .menu-action-link[aria-label='Abrir sacola']").forEach(link => {
            link.dataset.count = String(cartCount);
            link.classList.toggle("has-count", cartCount > 0);
        });

        document.querySelectorAll(".public-header [aria-label='Favoritos'], .public-header .menu-action-link[aria-label='Abrir favoritos']").forEach(link => {
            link.dataset.count = String(favoritesCount);
            link.classList.toggle("has-count", favoritesCount > 0);
        });
    }

    function getCustomerToken() {
        return sessionStorage.getItem("petflow_customer_token");
    }

    function readCustomerCache() {
        return readJson("petflow_customer_user", null);
    }

    function readJson(key, fallback) {
        try {
            return JSON.parse(sessionStorage.getItem(key) || JSON.stringify(fallback));
        } catch {
            return fallback;
        }
    }

    function getFirstName(name) {
        const firstName = String(name || "Cliente").trim().split(/\s+/)[0] || "Cliente";
        return firstName.length > 12 ? `${firstName.slice(0, 11)}...` : firstName;
    }
})();
