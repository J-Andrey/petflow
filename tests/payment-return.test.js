"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const id = "10000000-0000-0000-0000-000000000001";
function page({search = "?pagamento=retorno&pedido=" + id, token = "session", own = true, payments = [{status:"PAGAMENTO_APROVADO",pagseguroStatus:"PAID"}]} = {}) {
    const listeners = {}, timers = new Map(), calls = [], states = [...payments]; let nextTimer = 0, current = "AGUARDANDO_PAGAMENTO";
    const nodes = {publicOrdersList:{innerHTML:"",addEventListener(name,fn){listeners[name]=fn;}},ordersStatus:{textContent:""}};
    const browser = {location:{search,href:"/meus-pedidos",hostname:"loja.example"},addEventListener(name,fn){listeners[name]=fn;}};
    const context=vm.createContext({window:browser,document:{addEventListener(){},getElementById(key){return nodes[key];}},sessionStorage:{getItem(){return token;}},URL,URLSearchParams,Date,console,
        setTimeout(fn){const key=++nextTimer;timers.set(key,fn);return key;},clearTimeout(key){timers.delete(key);}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../public/js/pages/auth/public-auth.js"),"utf8"),context);
    context.request=async(endpoint,method="GET",body)=>{
        calls.push({endpoint,method,body});
        if(endpoint==="/clientes/pedidos")return {data:own?[{id,status:current,itens:[],reserva_expira_em:new Date(Date.now()+600000),pagseguro_checkout_id:"CHEC_test"}]:[]};
        if(endpoint.startsWith("/pagamentos/")){
            const result=states.shift()||payments.at(-1);
            if(result instanceof Error)throw result;
            current=result.status;return {payment:result};
        }
        if(endpoint==="/pagamentos")return {payment:{checkoutUrl:"https://pagamento.pagbank.com.br/pagamento?code=test"}};
        throw Error("Requisição inesperada: "+endpoint);
    };
    return {context,nodes,listeners,calls,timers,start:()=>context.setupPublicOrders(),async tick(){const entry=timers.entries().next().value;assert.ok(entry,"Consulta programada deve existir");timers.delete(entry[0]);entry[1]();await new Promise(setImmediate);}};
}
test("retorno PagBank consulta a cobrança e atualiza pedidos sem criar pagamento",async()=>{
    const p=page();await p.start();
    assert.equal(p.calls.filter(c=>c.endpoint==="/pagamentos/"+id).length,1);
    assert.ok(p.calls.every(c=>c.method==="GET"));
    assert.match(p.nodes.ordersStatus.textContent,/Pagamento confirmado/);
    assert.match(p.nodes.publicOrdersList.innerHTML,/Pedido recebido/);
    assert.equal(p.timers.size,0);
});
test("análise pendente acompanha até aprovação e para após confirmação",async()=>{
    const p=page({payments:[{status:"AGUARDANDO_PAGAMENTO",pagseguroStatus:"IN_ANALYSIS"},{status:"PAGAMENTO_APROVADO",pagseguroStatus:"PAID"}]});
    await p.start();assert.match(p.nodes.ordersStatus.textContent,/analisando/);assert.equal(p.timers.size,1);
    await p.tick();assert.match(p.nodes.ordersStatus.textContent,/Pagamento confirmado/);assert.equal(p.timers.size,0);
    assert.equal(p.calls.filter(c=>c.endpoint.startsWith("/pagamentos/")).length,2);
});
test("acompanhamento automático é limitado e permite consulta manual depois",async()=>{
    const p=page({payments:[{status:"AGUARDANDO_PAGAMENTO",pagseguroStatus:"IN_ANALYSIS"}]});await p.start();
    for(let n=0;n<5;n++)await p.tick();
    assert.equal(p.calls.filter(c=>c.endpoint.startsWith("/pagamentos/")).length,6);assert.equal(p.timers.size,0);
    assert.match(p.nodes.ordersStatus.textContent,/Use Consultar pagamento/);
    const button={dataset:{checkPayment:id},disabled:false};await p.listeners.click({target:{closest(){return button;}}});
    assert.equal(p.calls.filter(c=>c.endpoint.startsWith("/pagamentos/")).length,7);assert.equal(button.disabled,false);assert.equal(p.timers.size,0);
});
test("cartão recusado informa nova tentativa no mesmo pedido sem repetir automaticamente",async()=>{
    const p=page({payments:[{status:"AGUARDANDO_PAGAMENTO",pagseguroStatus:"DECLINED"}]});await p.start();
    assert.match(p.nodes.ordersStatus.textContent,/cartão foi recusado/);assert.equal(p.timers.size,0);assert.ok(p.calls.every(c=>c.method==="GET"));
    const button={dataset:{payOrder:id},disabled:false};await p.listeners.click({target:{closest(){return button;}}});
    assert.equal(p.calls.filter(c=>c.endpoint==="/pagamentos"&&c.method==="POST").length,1);
    assert.equal(p.calls.some(c=>c.endpoint==="/pedidos"),false);
});
test("retorno sem sessão preserva destino e login só aceita destino interno previsto",async()=>{
    const p=page({token:null});await p.start();assert.equal(p.context.window.location.href,"/login?retorno=pedidos&pedido="+id);assert.equal(p.calls.length,0);
    p.context.window.location.search="?retorno=pedidos&pedido="+id;assert.equal(p.context.publicLoginDestination(),"/meus-pedidos?pagamento=retorno&pedido="+id);
    p.context.window.location.search="?retorno=https://evil.test&pedido="+id;assert.equal(p.context.publicLoginDestination(),"/");
});
test("URL adulterada ou pedido fora da lista do cliente não dispara consulta",async()=>{
    for(const options of [{own:false},{search:"?pagamento=retorno&pedido=javascript:alert(1)"},{search:""}]){
        const p=page(options);await p.start();assert.equal(p.calls.some(c=>c.endpoint.startsWith("/pagamentos")),false);
    }
});
test("falha de consulta e saída da página interrompem acompanhamento sem nova cobrança",async()=>{
    const failure=page({payments:[new Error("PagBank indisponível.")]});await failure.start();
    assert.match(failure.nodes.ordersStatus.textContent,/PagBank indisponível/);assert.equal(failure.timers.size,0);
    const p=page({payments:[{status:"AGUARDANDO_PAGAMENTO",pagseguroStatus:"WAITING"}]});await p.start();p.listeners.pagehide();assert.equal(p.timers.size,0);
});
test("pagamento tardio em pedido cancelado pede conferência e nunca anuncia entrega",async()=>{
    const p=page({payments:[{status:"CANCELADA",pagseguroStatus:"PAID"}]});await p.start();
    assert.match(p.nodes.ordersStatus.textContent,/após o encerramento/);assert.doesNotMatch(p.nodes.ordersStatus.textContent,/Pagamento confirmado/);assert.equal(p.timers.size,0);
});

test("retorno antes da cobrança ficar visível acompanha ACTIVE até confirmação",async()=>{
    const p=page({payments:[{status:"AGUARDANDO_PAGAMENTO",pagseguroStatus:"ACTIVE"},{status:"PAGAMENTO_APROVADO",pagseguroStatus:"PAID"}]});
    await p.start();assert.equal(p.timers.size,1);await p.tick();assert.match(p.nodes.ordersStatus.textContent,/Pagamento confirmado/);assert.equal(p.timers.size,0);
});
test("saída durante carga inicial não inicia acompanhamento em segundo plano",async()=>{
    const p=page();let finish;p.context.request=endpoint=>{p.calls.push({endpoint,method:"GET"});return new Promise(resolve=>{finish=()=>resolve({data:[{id,status:"AGUARDANDO_PAGAMENTO",itens:[]}]});});};
    const loading=p.start();p.listeners.pagehide();finish();await loading;
    assert.equal(p.calls.length,1);assert.equal(p.timers.size,0);assert.equal(p.nodes.publicOrdersList.innerHTML,"");
});

test("erro de consulta automática antiga não substitui mensagem da ação manual atual",async()=>{
    const p=page();const original=p.context.request;let rejectAutomatic;
    p.context.request=(endpoint,method="GET",body)=>{
        if(endpoint.startsWith("/pagamentos/")){p.calls.push({endpoint,method});return new Promise((resolve,reject)=>{rejectAutomatic=reject;});}
        return original(endpoint,method,body);
    };
    const loading=p.start();await new Promise(setImmediate);
    await p.listeners.click({target:{closest(){return {dataset:{payOrder:id},disabled:false};}}});
    assert.match(p.nodes.ordersStatus.textContent,/Preparando o pagamento/);
    rejectAutomatic(new Error("Falha da consulta anterior."));await loading;
    assert.match(p.nodes.ordersStatus.textContent,/Preparando o pagamento/);assert.doesNotMatch(p.nodes.ordersStatus.textContent,/consulta anterior/);
});

test("Voltar restaura página do cache, atualiza pedido e mantém botões funcionais",async()=>{
    const p=page();await p.start();p.listeners.pagehide();
    await p.listeners.pageshow({persisted:true});assert.match(p.nodes.ordersStatus.textContent,/Pagamento confirmado/);
    const checks=p.calls.filter(c=>c.endpoint.startsWith("/pagamentos/")).length;assert.equal(checks,2);
    await p.listeners.click({target:{closest(){return {dataset:{checkPayment:id},disabled:false};}}});
    assert.equal(p.calls.filter(c=>c.endpoint.startsWith("/pagamentos/")).length,3);assert.match(p.nodes.ordersStatus.textContent,/Pagamento confirmado/);
    await p.listeners.click({target:{closest(){return {dataset:{payOrder:id},disabled:false};}}});
    assert.equal(p.context.window.location.href,"https://pagamento.pagbank.com.br/pagamento?code=test");
});
