"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {load}=require("./helpers");
function setup(order) {
    const calls=[],effects={stock:0,finance:0,updates:0};
    const client={async query(sql,params){
        calls.push({sql,params});
        if(sql.includes("FROM vendas"))return {rows:[order]};
        if(sql.includes("FROM itens_venda"))return {rows:[{produto_id:"p",quantidade:1}]};
        if(sql.includes("FROM financeiro"))return {rows:[]};
        return {rows:[]};
    },release(){}};
    const model={async atualizarPagamentoPorReferencia(ref,data){effects.updates++;return {...order,status:data.status};},async buscarPorId(){return {...order,cliente:null};}};
    const db={async connect(){return client;},async transaction(fn){return fn(client);}};
    const service=load("services/vendaService.js",{
        "../database/connection":db,"../models/vendaModel":model,"../models/itemVendaModel":{},
        "./movimentacaoEstoqueService":{async saida(){effects.stock++;}},
        "./financeiroService":{async gerarContaReceber(){effects.finance++;}},
        "./reservationService":{async release(){calls.push({sql:"RELEASE"});}},
        "./emailService":{}
    });
    return {service,calls,effects};
}
test("webhook repetido após entrega não baixa estoque nem gera financeiro",async()=>{
    const {service,effects}=setup({id:"sale",empresa_id:"company",status:"ENTREGUE",estoque_baixado_em:new Date()});
    const result=await service.confirmarPagamento(null,"sale",{pagseguroStatus:"PAID"});
    assert.equal(result.status,"ENTREGUE");assert.equal(effects.stock,0);assert.equal(effects.finance,0);
});
test("primeira confirmação baixa uma vez e registra marca persistente",async()=>{
    const {service,calls,effects}=setup({id:"sale",empresa_id:"company",status:"AGUARDANDO_PAGAMENTO",estoque_baixado_em:null});
    await service.confirmarPagamento(null,"sale",{pagseguroStatus:"PAID"});
    assert.equal(effects.stock,1);assert.equal(effects.finance,1);
    assert.ok(calls.some(c=>c.sql.includes("SET estoque_baixado_em=NOW()")));
    assert.ok(calls.some(c=>c.sql.includes("SET confirmada_em=NOW()")));
    assert.equal(calls.filter(c=>c.sql==="COMMIT").length,1);
});
test("pagamento após cancelamento gera alerta sem ressuscitar pedido",async()=>{
    const {service,effects,calls}=setup({id:"sale",empresa_id:"company",status:"CANCELADA",estoque_baixado_em:null});
    assert.equal((await service.confirmarPagamento(null,"sale",{})).status,"CANCELADA");
    assert.equal(effects.stock,0);assert.ok(calls.some(c=>c.sql.includes("notificacoes_admin")));
});
test("evento antigo não regride pedido pago",async()=>{
    const {service,effects}=setup({id:"sale",empresa_id:"company",status:"EM_SEPARACAO",estoque_baixado_em:new Date()});
    assert.equal((await service.atualizarStatusPagamento(null,"sale","AGUARDANDO_PAGAMENTO")).status,"EM_SEPARACAO");
    assert.equal(effects.updates,0);
});
