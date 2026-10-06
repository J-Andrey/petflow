"use strict";
const { UUID } = require("./sessionService");
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
function money(value) {
    if (!["string", "number"].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value))) fail("Use valores monetários com até duas casas decimais.");
    const cents = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(cents) || cents > 9999999999) fail("Valor monetário fora do limite.");
    return cents / 100;
}
function text(value, maximum, required = false) {
    if (value == null && !required) return null;
    if (typeof value !== "string" || value.trim().length > maximum || (required && !value.trim())) fail("Confira os campos de texto do produto.");
    return value.trim() || null;
}
function normalize(data, before = {}) {
    const categoria = data.categoriaId ?? data.categoria_id ?? before.categoria_id;
    const fornecedor = data.fornecedorId ?? data.fornecedor_id ?? before.fornecedor_id ?? null;
    if (!UUID.test(categoria || "") || (fornecedor && !UUID.test(fornecedor))) fail("Categoria ou fornecedor inválido.");
    const status = data.status ?? before.status ?? true;
    if (![true, false, "true", "false"].includes(status)) fail("Status de produto inválido.");
    const minimum = data.estoque_minimo ?? before.estoque_minimo ?? 0;
    if (!/^[0-9]+$/.test(String(minimum)) || !Number.isSafeInteger(Number(minimum)) || Number(minimum) > 2147483647) fail("Estoque mínimo deve ser um inteiro não negativo.");
    const preco = money(data.preco ?? before.preco), custo = money(data.custo ?? before.custo);
    if (preco < custo) fail("O preço de venda não pode ser menor que o custo.");
    const nome = text(data.nome ?? before.nome, 150, true);
    if (nome.length < 3) fail("O nome deve ter ao menos três caracteres.");
    return { categoria, fornecedor: fornecedor || null, nome, preco, custo,
        descricao: text(data.descricao ?? before.descricao, 10000), sku: text(data.sku ?? before.sku, 50, true),
        codigo_barras: text(data.codigoBarras ?? data.codigo_barras ?? before.codigo_barras, 50),
        marca: text(data.marca ?? before.marca, 100),
        unidade_medida: text(data.unidade_medida ?? before.unidade_medida ?? "UN", 20, true),
        estoque_minimo: Number(minimum), status: status === true || status === "true" };
}
module.exports = { normalize, money };
