"use strict";
const {UUID}=require("./sessionService");
const transitions = Object.freeze({
    PENDENTE:["AGUARDANDO_PAGAMENTO","CANCELADA"],
    AGUARDANDO_PAGAMENTO:["CANCELADA"],
    PAGAMENTO_APROVADO:["EM_SEPARACAO"],
    EM_SEPARACAO:["SAIU_PARA_ENTREGA"],
    SAIU_PARA_ENTREGA:["ENTREGUE"],
    ENTREGUE:["FINALIZADA"],
    FINALIZADA:[], CANCELADA:[]
});
function assertTransition(current,next) {
    if(next==="PAGAMENTO_APROVADO") throw Object.assign(new Error("Somente o PagBank pode confirmar o pagamento."),{status:403});
    if(current===next) return;
    if(!transitions[current]?.includes(next)) throw Object.assign(new Error("Transição inválida. Para cancelamento de pedido pago, abra uma solicitação de atendimento."),{status:409});
}
function normalizeItems(items) {
    if(!Array.isArray(items)||items.length<1||items.length>100) throw Object.assign(new Error("Informe entre 1 e 100 itens."),{status:400});
    const totals=new Map();
    for(const item of items) {
        const id=item?.produto_id ?? item?.produtoId;
        const quantity=Number(item?.quantidade);
        if(!UUID.test(id)||!Number.isSafeInteger(quantity)||quantity<1||quantity>999) throw Object.assign(new Error("Produto ou quantidade inválidos."),{status:400});
        totals.set(id,(totals.get(id)||0)+quantity);
        if(totals.get(id)>999) throw Object.assign(new Error("Quantidade máxima por produto: 999."),{status:400});
    }
    // Ordem determinística reduz deadlocks entre pedidos com produtos em ordem inversa.
    return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([produto_id,quantidade])=>({produto_id,quantidade}));
}
function reservationMinutes(value=process.env.ORDER_RESERVATION_MINUTES||30) {
    const minutes=Number(value);
    if(!Number.isInteger(minutes)||minutes<1||minutes>1440) throw new Error("ORDER_RESERVATION_MINUTES deve estar entre 1 e 1440.");
    return minutes;
}
module.exports={assertTransition,normalizeItems,reservationMinutes};
