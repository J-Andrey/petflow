"use strict";
const {normalizeItems}=require("./orderRules");
function discountCents(coupon,subtotal) {
    if(!Number.isSafeInteger(subtotal)||subtotal<0)throw new Error("Subtotal inválido.");
    if(subtotal<Math.round(Number(coupon.minimo_compra)*100))throw Object.assign(new Error("Compra abaixo do mínimo do cupom."),{status:400});
    let discount=coupon.tipo==="PERCENTUAL"?Math.round(subtotal*Number(coupon.valor)/100):Math.round(Number(coupon.valor)*100);
    if(coupon.desconto_maximo!=null)discount=Math.min(discount,Math.round(Number(coupon.desconto_maximo)*100));
    return Math.min(subtotal,Math.max(0,discount));
}
async function validate(client,{empresaId,clienteId,code,subtotal,lock=false}) {
    const normalized=String(code||"").trim().toUpperCase();
    if(!normalized)return {code:null,cents:0};
    if(!/^[A-Z0-9_-]{3,40}$/.test(normalized))throw Object.assign(new Error("Cupom inválido."),{status:400});
    const {rows}=await client.query(`SELECT * FROM cupons WHERE empresa_id=$1 AND codigo=$2
        AND ativo=TRUE AND inicia_em<=NOW() AND (expira_em IS NULL OR expira_em>NOW()) ${lock?"FOR UPDATE":""}`,[empresaId,normalized]);
    const coupon=rows[0];
    if(!coupon)throw Object.assign(new Error("Cupom indisponível."),{status:400});
    const uses=await client.query(`SELECT COUNT(*)::integer AS total,
        COUNT(*) FILTER(WHERE cliente_id=$3)::integer AS cliente FROM vendas
        WHERE empresa_id=$1 AND cupom_codigo=$2 AND status<>'CANCELADA'`,[empresaId,normalized,clienteId||null]);
    if((coupon.limite_usos&&uses.rows[0].total>=coupon.limite_usos)||
        (coupon.limite_por_cliente&&(!clienteId||uses.rows[0].cliente>=coupon.limite_por_cliente)))
        throw Object.assign(new Error(clienteId?"Limite de uso do cupom atingido.":"Entre na conta para validar este cupom."),{status:400});
    return {code:normalized,cents:discountCents(coupon,subtotal)};
}
async function preview(db,empresaId,clienteId,data) {
    const items=normalizeItems(data.itens);
    const {rows}=await db.query("SELECT id,preco FROM produtos WHERE empresa_id=$1 AND ativo=TRUE AND id=ANY($2::uuid[])",[empresaId,items.map(item=>item.produto_id)]);
    if(rows.length!==items.length)throw Object.assign(new Error("Produto indisponível."),{status:400});
    const prices=new Map(rows.map(p=>[p.id,Math.round(Number(p.preco)*100)]));
    const subtotal=items.reduce((sum,item)=>sum+prices.get(item.produto_id)*item.quantidade,0);
    const discount=await validate(db,{empresaId,clienteId,code:data.codigo,subtotal});
    return {subtotal_centavos:subtotal,desconto_centavos:discount.cents,codigo:discount.code};
}
module.exports={discountCents,validate,preview};
