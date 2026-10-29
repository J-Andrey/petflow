"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function homeSearch(products) {
    const inserted = [];
    const grid = {
        innerHTML: "",
        insertAdjacentHTML(position, markup) {
            inserted.push({ position, markup });
            this.innerHTML = position === "afterbegin" ? markup + this.innerHTML : this.innerHTML + markup;
        }
    };
    let scrolls = 0;
    const context = vm.createContext({
        document: {
            addEventListener() {},
            querySelector: selector => selector === ".products-grid" ? grid : null,
            querySelectorAll: () => [],
            getElementById: id => id === "products" ? { scrollIntoView() { scrolls++; } } : null
        },
        sessionStorage: { getItem: () => null },
        fetch() { assert.fail("A busca local não deve consultar APIs."); }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/js/pages/home/catalog.js"), "utf8"), context);
    context.inputProducts = products;
    vm.runInContext("publicProducts = inputProducts", context);
    return {
        grid,
        inserted,
        scrolls: () => scrolls,
        search(term, shouldScroll = false) { context.applyPublicSearch(term, shouldScroll); }
    };
}

const sampleProducts = [
    { id: "felis", nome: "Felis Prime", descricao: "Alimentação para gatos", categoria: "Rações", sku: "FEL-01", preco: 45 },
    { id: "cao", nome: "Ração para cães", descricao: "Cuidado diário", categoria: "Rações", sku: "DOG-01", preco: 50 }
];

test("busca home com correspondência exibe produto sem aviso de nenhum resultado", () => {
    const page = homeSearch(sampleProducts);
    page.search("Felis", true);
    assert.match(page.grid.innerHTML, /data-id="felis"/);
    assert.doesNotMatch(page.grid.innerHTML, /data-id="cao"|Nenhum produto|public-empty/);
    assert.deepEqual(page.inserted, []);
    assert.equal(page.scrolls(), 1);
});

test("busca home normaliza acentos, maiúsculas e espaços e mantém busca por SKU", () => {
    const page = homeSearch(sampleProducts);
    page.search("  ALIMENTACAO  ");
    assert.match(page.grid.innerHTML, /data-id="felis"/);
    assert.doesNotMatch(page.grid.innerHTML, /data-id="cao"|public-empty/);
    page.search("dog-01");
    assert.match(page.grid.innerHTML, /data-id="cao"/);
    assert.doesNotMatch(page.grid.innerHTML, /data-id="felis"|public-empty/);
});

test("busca home sem correspondência apresenta só o aviso e limpar restaura os destaques", () => {
    const page = homeSearch(sampleProducts);
    page.search("produto inexistente");
    assert.match(page.grid.innerHTML, /class="public-empty"/);
    assert.match(page.grid.innerHTML, /Nenhum produto encontrado para essa busca/);
    assert.doesNotMatch(page.grid.innerHTML, /data-product-card/);
    page.search("   ");
    assert.match(page.grid.innerHTML, /data-id="felis"/);
    assert.match(page.grid.innerHTML, /data-id="cao"/);
    assert.doesNotMatch(page.grid.innerHTML, /public-empty|Nenhum produto/);
});

test("home sem termo mantém limite de seis destaques e mensagem própria para catálogo vazio", () => {
    const page = homeSearch(Array.from({ length: 8 }, (_, index) => ({ id: "item-" + index, nome: "Item " + index, preco: 10 })));
    page.search("");
    assert.equal((page.grid.innerHTML.match(/data-product-card/g) || []).length, 6);
    assert.doesNotMatch(page.grid.innerHTML, /data-id="item-6"|data-id="item-7"|public-empty/);
    const empty = homeSearch([]);
    empty.search("");
    assert.match(empty.grid.innerHTML, /Nenhum produto disponível no momento/);
    assert.doesNotMatch(empty.grid.innerHTML, /Nenhum produto encontrado para essa busca|data-product-card/);
});
