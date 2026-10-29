"use strict";

const CATEGORY_API = window.location.hostname === "localhost"
    ? "http://localhost:4500/api/public"
    : "/api/public";

const CATEGORY_CONFIG = {
    caes: {
        title: "Produtos para cães",
        description: "Rações, petiscos, acessórios e cuidados selecionados para cachorros.",
        image: "/images/categories/dogs-photo-20261029.jpg",
        keywords: ["cao", "caes", "cachorro", "canis", "bifinho", "coleira", "adultos"]
    },
    gatos: {
        title: "Produtos para gatos",
        description: "Itens escolhidos para gatos, com foco em alimentação, conforto e rotina.",
        image: "/images/categories/cats-photo-20261029.jpg",
        keywords: ["gato", "gatos", "felis", "castrados"]
    },
    aves: {
        title: "Produtos para aves",
        description: "Alimentos, acessórios e cuidados para aves de estimação.",
        image: "/images/categories/birds-photo-20261029.jpg",
        keywords: ["ave", "aves", "passaro", "passaros", "calopsita", "periquito"]
    },
    peixes: {
        title: "Produtos para peixes",
        description: "Itens para aquários, alimentação, limpeza e bem-estar dos peixes.",
        image: "/images/categories/fish-photo-20261029.jpg",
        keywords: ["peixe", "peixes", "aquario", "aquarios"]
    },
    roedores: {
        title: "Produtos para roedores",
        description: "Produtos para hamster, porquinho-da-índia, coelhos e pequenos pets.",
        image: "/images/categories/rodents-photo-20261029.jpg",
        keywords: ["roedor", "roedores", "hamster", "coelho", "porquinho"],
        fallbackCategories: ["Petiscos", "Acessórios", "Higiene"]
    },
    repteis: {
        title: "Produtos para répteis",
        description: "Rações, acessórios e cuidados para tartarugas, jabutis e outros répteis de estimação.",
        image: "/images/categories/jabuti-photo-20261029.jpg",
        keywords: ["repteis", "reptil", "tartaruga", "jabuti", "quelonio"]
    },
    acessorios: {
        title: "Acessórios para pets",
        description: "Coleiras, brinquedos, camas, transporte e acessórios para a rotina do pet.",
        image: "/images/categories/accessories.jpg",
        keywords: ["acessorio", "acessorios", "coleira", "brinquedo", "cama", "mordedor"],
        fallbackCategories: ["Acessórios"]
    }
};

let allProducts = [];
let publicFavorites = new Set(JSON.parse(sessionStorage.getItem("petflow_public_favorites") || "[]"));
let currentSlug = "caes";

document.addEventListener("DOMContentLoaded", () => {
    setupCategoryPage();
});

document.addEventListener("petflow:customer-logout", () => {
    publicFavorites = new Set();
    applyFilters();
});

async function setupCategoryPage() {
    currentSlug = CATEGORY_CONFIG[getCurrentSlug()] ? getCurrentSlug() : "caes";
    renderCategoryHeader(CATEGORY_CONFIG[currentSlug]);
    setupToolbar();

    try {
        const response = await fetch(`${CATEGORY_API}/produtos`);
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.message || "Produtos indisponíveis.");
        }

        allProducts = Array.isArray(payload.data) ? payload.data : [];
        applyFilters();
    } catch (error) {
        renderEmpty(error.message || "Não foi possível carregar os produtos.");
    }
}

function setupToolbar() {
    const search = document.getElementById("categorySearch");
    const filter = document.getElementById("categoryFilter");
    const toolbar = document.getElementById("categoryToolbar");

    if (filter) {
        filter.value = currentSlug;
        filter.addEventListener("change", () => {
            currentSlug = filter.value;
            renderCategoryHeader(CATEGORY_CONFIG[currentSlug]);
            updateUrl(currentSlug);
            applyFilters();
        });
    }

    search?.addEventListener("input", applyFilters);
    toolbar?.addEventListener("submit", event => {
        event.preventDefault();
        applyFilters();
    });
}

function applyFilters() {
    const config = CATEGORY_CONFIG[currentSlug];
    const query = normalize(document.getElementById("categorySearch")?.value || "");
    const categoryProducts = filterByPetCategory(allProducts, config);
    const products = query ? filterBySearch(categoryProducts, query) : categoryProducts;

    renderProducts(products, config, query);
}

function renderCategoryHeader(config) {
    document.title = `PetFlow | ${config.title}`;
    setText("categoryTitle", config.title);
    setText("categoryDescription", config.description);

    const image = document.getElementById("categoryImage");

    if (image) {
        image.src = config.image;
        image.alt = config.title;
    }
}

function filterByPetCategory(products, config) {
    const matches = products.filter(product => {
        const haystack = productHaystack(product);
        return config.keywords.some(keyword => haystack.includes(keyword));
    });

    if (matches.length || !config.fallbackCategories?.length) {
        return matches;
    }

    const allowed = config.fallbackCategories.map(normalize);
    return products.filter(product => allowed.includes(normalize(product.categoria)));
}

function filterBySearch(products, query) {
    return products.filter(product => productHaystack(product).includes(query));
}

function productHaystack(product) {
    return normalize([
        product.nome,
        product.descricao,
        product.categoria,
        product.marca,
        product.fornecedor,
        product.sku
    ].filter(Boolean).join(" "));
}

function renderProducts(products, config, query = "") {
    const grid = document.getElementById("categoryProducts");

    if (!grid) {
        return;
    }

    if (!products.length) {
        const message = query
            ? `Nenhum produto encontrado para "${query}" em ${config.title.toLowerCase()}.`
            : `Ainda não há produtos cadastrados para ${config.title.toLowerCase()}.`;

        renderEmpty(message);
        return;
    }

    grid.innerHTML = products.map(product => {
        const id = String(product.id || product.sku || product.nome);
        const href = `/produtos/${productSlug(product)}`;
        const inCart = Boolean(readCart()[id]);
        const favorite = publicFavorites.has(id);

        return `
            <article class="product-card" data-product-id="${escapeHtml(id)}">
                <a class="product-link" href="${escapeHtml(href)}" aria-label="Ver produto ${escapeHtml(product.nome)}">
                    <img src="${escapeHtml(product.foto || "/images/products/petflow-prime-racao.jpg")}" alt="${escapeHtml(product.nome)}" loading="lazy" decoding="async">
                </a>
                <div class="product-content">
                    <span class="product-category">${escapeHtml(product.categoria || "PetFlow")}</span>
                    <h3 class="product-title"><a href="${escapeHtml(href)}">${escapeHtml(product.nome)}</a></h3>
                    <p class="product-description">${escapeHtml(product.descricao || "Produto selecionado para o seu pet.")}</p>
                    <div class="product-footer">
                        <strong class="product-price">${currency(product.preco)}</strong>
                        <div class="product-actions">
                            <button class="cart-action ${inCart ? "is-active" : ""}" type="button" data-add-cart="${escapeHtml(id)}">
                                <i class="fa-solid ${inCart ? "fa-check" : "fa-plus"}"></i>
                                <span>${inCart ? "Na sacola" : "Adicionar à sacola"}</span>
                            </button>
                            <button class="cart-action favorite ${favorite ? "is-active" : ""}" type="button" data-favorite-product="${escapeHtml(id)}" aria-label="Favoritar ${escapeHtml(product.nome)}">
                                <i class="fa-${favorite ? "solid" : "regular"} fa-heart"></i>
                                <span>${favorite ? "Favorito" : "Favoritar"}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    bindCartButtons();
}

function renderEmpty(message) {
    const grid = document.getElementById("categoryProducts");

    if (!grid) {
        return;
    }

    grid.innerHTML = `
        <div class="empty-card">
            <i class="fa-regular fa-folder-open"></i>
            <strong>Categoria em atualização</strong>
            <p>${escapeHtml(message)} Enquanto isso, veja os destaques da loja ou fale com a equipe PetFlow.</p>
        </div>
    `;
}

function bindCartButtons() {
    document.querySelectorAll("[data-add-cart]").forEach(button => {
        button.addEventListener("click", () => {
            const id = button.dataset.addCart;
            const cart = readCart();

            cart[id] = 1;
            sessionStorage.setItem("petflow_public_cart", JSON.stringify(cart));

            button.classList.add("is-active");
            button.innerHTML = `<i class="fa-solid fa-check"></i><span>Na sacola</span>`;
            window.PetFlowPublicHeader?.update();
        });
    });

    document.querySelectorAll("[data-favorite-product]").forEach(button => {
        button.addEventListener("click", () => {
            const id = button.dataset.favoriteProduct;

            if (publicFavorites.has(id)) {
                publicFavorites.delete(id);
            } else {
                publicFavorites.add(id);
            }

            sessionStorage.setItem("petflow_public_favorites", JSON.stringify([...publicFavorites]));
            window.PetFlowPublicHeader?.update();
            applyFilters();
        });
    });
}

function productSlug(product) {
    return slugify(product.sku || product.nome || product.id);
}

function updateUrl(slug) {
    const nextPath = `/categorias/${slug}`;

    if (window.location.pathname !== nextPath) {
        window.history.pushState({}, "", nextPath);
    }
}

function readCart() {
    try {
        return JSON.parse(sessionStorage.getItem("petflow_public_cart") || "{}") || {};
    } catch {
        return {};
    }
}

function getCurrentSlug() {
    return window.location.pathname.split("/").filter(Boolean).pop() || "caes";
}

function slugify(value) {
    return normalize(value)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

function normalize(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function currency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
