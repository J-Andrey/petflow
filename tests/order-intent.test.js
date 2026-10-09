"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {load,response}=require("./helpers");
const intents=require("../services/orderIntentService"),rules=require("../services/orderRules"),{normalizeAddress}=require("../services/deliveryService");
const id="10000000-0000-0000-0000-000000000001",product="20000000-0000-0000-0000-000000000002";
const address={cep:"01310-100",endereco:"Rua Escolhida",numero:"20",complemento:"",bairro:"Centro",cidade:"São Paulo",estado:"sp"};
test("intenção identifica conteúdo normalizado e exclui token/preço/data transitórios",()=>{
    const sale={chave_pedido:id,cupom_codigo:" promo ",observacoes:" Entregar na porta ",cotacao_frete:"old-token",valor_total:6};
    const first=intents.prepare(sale,rules.normalizeItems([{produto_id:product,quantidade:2}]),normalizeAddress(address),"PAGBANK");
    const retry=intents.prepare({...sale,chave_pedido:id.toUpperCase(),cupom_codigo:"PROMO",observacoes:"Entregar na porta",cotacao_frete:"expired-token",valor_total:900},rules.normalizeItems([{produto_id:product,quantidade:1},{produto_id:product,quantidade:1}]),normalizeAddress({...address,cep:"01310100",estado:"SP",endereco:" Rua  Escolhida "}),"PAGBANK");
    assert.deepEqual(first,retry);assert.match(first.fingerprint,/^[a-f0-9]{64}$/);
    assert.notEqual(first.fingerprint,intents.prepare(sale,rules.normalizeItems([{produto_id:product,quantidade:1}]),normalizeAddress(address),"PAGBANK").fingerprint);
});
test("recuperação limita chave ao cliente/empresa e rejeita conteúdo divergente",async()=>{
    const intent={key:id,fingerprint:"a".repeat(64)},queries=[];
    const client={async query(sql,params){queries.push({sql,params});return {rows:[{fingerprint:"b".repeat(64),venda_id:"order"}]};}};
    await assert.rejects(intents.recover(client,"company","customer",intent),{status:409});
    assert.deepEqual(queries[0].params,["company","customer",id]);assert.equal(queries.length,1);
});
function controllerFixture(){
    let submitted;const customer={id:"customer",cep:"01310100",endereco:"Rua Cadastro",numero:"10",bairro:"Centro",cidade:"São Paulo",estado:"SP"};
    const controller=load("controllers/publicOrderController.js",{
        "../database/connection":{async query(){return {rows:[customer]};}},
        "../services/vendaService":{async finalizarVenda(company,sale,items){submitted={company,sale,items};return {reused:true,venda:{id,status:"CANCELADA"},itens:items};}},
    });
    return {controller,submitted:()=>submitted};
}
test("cliente JS antigo sem chave recebe orientação para atualizar antes de criar pedido",async()=>{
    const f=controllerFixture(),res=response();await f.controller.criarPedido({customer:{id:"customer",empresaId:"company"},body:{itens:[{produto_id:product,quantidade:1}]}},res,error=>assert.fail(error.message));
    assert.equal(res.statusCode,400);assert.match(res.body.message,/Atualize a página/);assert.equal(f.submitted(),undefined);
});
test("POST usa endereço escolhido nas observações e retorna status real de pedido reutilizado",async()=>{
    const f=controllerFixture(),res=response();await f.controller.criarPedido({customer:{id:"customer",empresaId:"company"},body:{chave_pedido:crypto.randomUUID(),itens:[{produto_id:product,quantidade:1}],endereco_entrega:address,observacoes:"Portaria"}},res,error=>assert.fail(error.message));
    assert.equal(res.statusCode,200);assert.equal(res.body.reused,true);assert.equal(res.body.payment.status,"CANCELADA");assert.match(f.submitted().sale.observacoes,/Rua Escolhida, 20/);assert.doesNotMatch(f.submitted().sale.observacoes,/Rua Cadastro/);assert.equal(f.submitted().sale.endereco_entrega.estado,"SP");
});
test("produto UUID com letras maiúsculas é consolidado antes do fingerprint e da reserva",()=>{
    const uuid="abcdefab-cdef-abcd-efab-cdefabcdefab";
    assert.deepEqual(rules.normalizeItems([{produto_id:uuid.toUpperCase(),quantidade:1},{produto_id:uuid,quantidade:2}]),[{produto_id:uuid,quantidade:3}]);
});
