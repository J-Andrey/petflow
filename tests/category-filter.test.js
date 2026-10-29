"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function categoryPage() {
    const context = vm.createContext({
        window: { location: { hostname: "example.test", pathname: "/categorias/repteis" } },
        document: { addEventListener() {} },
        sessionStorage: { getItem: () => null },
        fetch() { assert.fail("O teste do filtro não deve consultar APIs."); }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/js/pages/categories/category-detail.js"), "utf8"), context);
    return {
        filter(products, search = "") {
            context.inputProducts = products;
            context.inputSearch = search;
            return JSON.parse(vm.runInContext(`JSON.stringify(filterBySearch(
                filterByPetCategory(inputProducts, CATEGORY_CONFIG.repteis), normalize(inputSearch)
            ).map(product => product.id))`, context));
        },
        slug: () => vm.runInContext("getCurrentSlug()", context)
    };
}

test("categoria Répteis reconhece jabuti, tartaruga, réptil e quelônio nos campos do produto", () => {
    const page = categoryPage();
    const products = [
        { id: "jabuti", nome: "Ração para jabuti", categoria: "Rações" },
        { id: "tartaruga", nome: "Alimento aquático", descricao: "Alimento para tartarugas" },
        { id: "reptil", nome: "Suplemento mineral", categoria: "Répteis" },
        { id: "quelonio", nome: "Cálcio para quelônios" },
        { id: "sku", nome: "Substrato natural", sku: "REPTIL-01" },
        { id: "peixe", nome: "Ração para peixes", categoria: "Aquários" },
        { id: "cao", nome: "Ração para cães", categoria: "Rações" },
        { id: "ave", nome: "Mistura para calopsita", categoria: "Aves" }
    ];
    assert.equal(page.slug(), "repteis");
    assert.deepEqual(page.filter(products), ["jabuti", "tartaruga", "reptil", "quelonio", "sku"]);
});

test("busca da categoria Répteis normaliza acentos sem incluir produtos de outras categorias", () => {
    const page = categoryPage();
    const products = [
        { id: "jabuti", nome: "Ração para jabuti", marca: "Nutrição Pet" },
        { id: "tartaruga", nome: "Alimento para tartaruga", marca: "Nutrição Pet" },
        { id: "cao", nome: "Ração para cães", marca: "Nutrição Pet" }
    ];
    assert.deepEqual(page.filter(products, "  RAÇÃO  "), ["jabuti"]);
    assert.deepEqual(page.filter(products, "NUTRICAO"), ["jabuti", "tartaruga"]);
    assert.deepEqual(page.filter(products, "TARTARUGA"), ["tartaruga"]);
});

test("categoria Répteis vazia não substitui o resultado por rações ou acessórios genéricos", () => {
    const page = categoryPage();
    assert.deepEqual(page.filter([
        { id: "racao", nome: "Ração para cães", categoria: "Rações" },
        { id: "acessorio", nome: "Coleira", categoria: "Acessórios" }
    ]), []);
    assert.deepEqual(page.filter([]), []);
});
