"use strict";
// Allowlist: nunca persistir objetos inteiros vindos de contas, provedores ou requests.
const allowed = new Set(["id","nome","email","perfil","ativo","status","tipo","codigo","valor","descricao","resposta","protocolo","status_anterior","status_novo","preco","custo","categoria_id","fornecedor_id","sku","codigo_barras","marca","unidade_medida","estoque_minimo","quantidade"]);
function safeData(data) {
    if (!data) return null;
    return Object.fromEntries(Object.entries(data).filter(([key]) => allowed.has(key))
        .map(([key,value]) => [key, typeof value === "string" ? value.slice(0,2000) : typeof value === "boolean" || typeof value === "number" || value === null ? value : "[omitido]"]));
}
async function record(client, request, acao, entidade, id, before, after) {
    await client.query(`INSERT INTO auditoria_admin
        (empresa_id,usuario_id,acao,entidade,entidade_id,descricao,dados_anteriores,dados_novos,ip)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [request.user.empresaId,request.user.id,acao,entidade,id,acao+" "+entidade,safeData(before),safeData(after),request.ip]);
}
module.exports = { safeData, record };
