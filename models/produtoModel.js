"use strict";
const db = require("../database/connection");
const audit = require("../services/auditService");
const { normalize } = require("../services/productValidation");
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };

async function findAll(empresaId) {
    return (await db.query(`SELECT p.*,c.nome AS categoria,f.nome AS fornecedor,
        COALESCE(e.quantidade,0) AS quantidade
        FROM produtos p JOIN categorias c ON c.id=p.categoria_id AND c.empresa_id=p.empresa_id
        LEFT JOIN fornecedores f ON f.id=p.fornecedor_id AND f.empresa_id=p.empresa_id
        LEFT JOIN estoque e ON e.produto_id=p.id AND e.empresa_id=p.empresa_id
        WHERE p.empresa_id=$1 ORDER BY p.nome,p.id`, [empresaId])).rows;
}
async function findById(id, empresaId) {
    return (await db.query("SELECT * FROM produtos WHERE id=$1 AND empresa_id=$2", [id,empresaId])).rows[0] || null;
}
async function save(id, input, empresaId, req) {
    return db.transaction(async client => {
        const before=id?(await client.query("SELECT * FROM produtos WHERE id=$1 AND empresa_id=$2 FOR UPDATE", [id,empresaId])).rows[0]:null;
        if (id && !before) fail("Produto não encontrado.",404);
        const d=normalize(input,before || {});
        const category=await client.query("SELECT id FROM categorias WHERE id=$1 AND empresa_id=$2 AND ativo=TRUE AND status=TRUE FOR SHARE", [d.categoria,empresaId]);
        if (!category.rows[0]) fail("Categoria indisponível para esta empresa.",400);
        if (d.fornecedor) {
            const supplier=await client.query("SELECT id,ativo FROM fornecedores WHERE id=$1 AND empresa_id=$2 FOR SHARE", [d.fornecedor,empresaId]);
            if (!supplier.rows[0] || (!supplier.rows[0].ativo && before?.fornecedor_id!==d.fornecedor)) fail("Fornecedor indisponível para esta empresa.",400);
        }
        const values=[empresaId,d.categoria,d.fornecedor,d.nome,d.descricao,d.sku,d.codigo_barras,d.preco,d.custo,
            input.foto===undefined?(before?.foto || null):input.foto,d.marca,d.unidade_medida,d.estoque_minimo,d.status];
        const {rows}=id?await client.query(`UPDATE produtos SET categoria_id=$2,fornecedor_id=$3,nome=$4,descricao=$5,
            sku=$6,codigo_barras=$7,preco=$8,preco_venda=$8,custo=$9,preco_custo=$9,foto=$10,
            marca=$11,unidade_medida=$12,estoque_minimo=$13,status=$14,ativo=$14,updated_at=NOW()
            WHERE empresa_id=$1 AND id=$15 RETURNING *`, [...values,id]):
            await client.query(`INSERT INTO produtos(empresa_id,categoria_id,fornecedor_id,nome,descricao,sku,codigo_barras,
            preco,preco_venda,custo,preco_custo,foto,marca,unidade_medida,estoque_minimo,status,ativo)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9,$10,$11,$12,$13,$14,$14) RETURNING *`, values);
        const saved=rows[0];
        await client.query(`INSERT INTO estoque(empresa_id,produto_id,estoque_minimo) VALUES($1,$2,$3)
            ON CONFLICT(empresa_id,produto_id) DO UPDATE SET estoque_minimo=EXCLUDED.estoque_minimo,updated_at=NOW()`, [empresaId,saved.id,d.estoque_minimo]);
        if (req) await audit.record(client,req,id?"ATUALIZAR":"CRIAR","produtos",saved.id,before,saved);
        return saved;
    });
}
const create=(produto,req)=>save(null,produto,produto.empresaId,req);
const update=(id,produto,empresaId,req)=>save(id,produto,empresaId,req);
async function remove(id,empresaId,req) {
    return db.transaction(async client=>{
        const before=(await client.query("SELECT * FROM produtos WHERE id=$1 AND empresa_id=$2 FOR UPDATE", [id,empresaId])).rows[0];
        if (!before) fail("Produto não encontrado.",404);
        const saved=(await client.query("UPDATE produtos SET status=FALSE,ativo=FALSE,updated_at=NOW() WHERE id=$1 AND empresa_id=$2 RETURNING *", [id,empresaId])).rows[0];
        if (req) await audit.record(client,req,"DESATIVAR","produtos",id,before,saved);
        return saved;
    });
}
module.exports={findAll,findById,create,update,remove};

