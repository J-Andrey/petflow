"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
function element(tag="div"){
    const node={tagName:tag.toUpperCase(),value:"",children:[],disabled:false,hidden:false,listeners:{},controls:[],append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){},addEventListener(name,callback){this.listeners[name]=callback;},classList:{add(){}}};
    let text="";Object.defineProperty(node,"textContent",{get(){return text;},set(value){text=value;this.children=[];}});
    node.querySelectorAll=()=>[...node.controls,...node.children.flatMap(child=>[...(["INPUT","TEXTAREA","BUTTON"].includes(child.tagName)?[child]:[]),...child.querySelectorAll()])];
    return node;
}
const address={cep:"01310100",endereco:"Rua Original",numero:"10",complemento:"",bairro:"Centro",cidade:"São Paulo",estado:"SP"};
const event={preventDefault(){}};
const wait=()=>new Promise(resolve=>setImmediate(resolve));
async function page(options={}){
    const nodes=Object.fromEntries(["cartItems","cartTotal","cartTotalLabel","cartBreakdown","cartStatus","cartCustomer","couponStatus","deliveryStatus","quoteDelivery","removeCoupon","recoverOrder","chooseMore","cartForm","couponForm","deliveryForm"].map(id=>[id,element()]));
    const submit=element("button");nodes.cartForm.querySelector=()=>submit;nodes.cartForm.elements={observacoes:element("textarea")};nodes.couponForm.elements={codigo:element("input")};
    nodes.deliveryForm.elements=Object.fromEntries(Object.keys(address).map(key=>[key,element("input")]));nodes.deliveryForm.checkValidity=()=>false;
    nodes.cartForm.controls=[submit,nodes.cartForm.elements.observacoes,nodes.recoverOrder];nodes.couponForm.controls=[nodes.couponForm.elements.codigo,element("button"),nodes.removeCoupon];nodes.deliveryForm.controls=[...Object.values(nodes.deliveryForm.elements),nodes.quoteDelivery];
    let ready,interval,timerId=0;const timers=new Map(),storage=options.storage||new Map([["petflow_public_cart",JSON.stringify({product:1})],["petflow_customer_token","test"]]);const calls=[];
    const controller={
        preview:async body=>body.codigo==="BAD"?{ok:false,message:"Cupom indisponível."}:{ok:true,data:{subtotal_centavos:10000*body.itens.reduce((sum,item)=>sum+item.quantidade,0),desconto_centavos:body.codigo?1000:0,codigo:body.codigo||null}},
        quote:async()=>({ok:false,message:"Frete indisponível."}),
        cep:async value=>({ok:true,data:{...address,cep:value}}),
        profile:async()=>({ok:true,data:{id:options.customerId||"customer",nome:"Cliente"}}),
        order:async()=>({ok:true,data:{id:"10000000-0000-0000-0000-000000000001",status:"AGUARDANDO_PAGAMENTO"}}),
        payment:async()=>({ok:true,payment:{checkoutUrl:"https://pagamento.pagbank.com.br/pagamento?code=test"}}),
    };
    Object.assign(controller,options.controller);
    const browser={location:{href:"/sacola"},PetFlowPublicHeader:{update(){}}};browser.top=browser;
    const context=vm.createContext({window:browser,parent:browser,location:{search:"",origin:"http://local"},URL,URLSearchParams,Date,crypto:{randomUUID:()=>crypto.randomUUID()},
        document:{getElementById:id=>nodes[id],createElement:tag=>element(tag),addEventListener:(name,callback)=>{if(name==="DOMContentLoaded")ready=callback;},body:element()},
        sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},localStorage:{removeItem:key=>storage.delete(key)},
        setInterval:callback=>{interval=callback;},setTimeout:callback=>{timers.set(++timerId,callback);return timerId;},clearTimeout:id=>timers.delete(id),
        fetch:async(url,options)=>{const body=options.body?JSON.parse(options.body):{};calls.push({url,body,headers:options.headers});let result;
            if(url.endsWith("/produtos"))result={ok:true,data:[{id:"product",nome:"Ração",preco:100,estoque_disponivel:10}]};
            else if(url.endsWith("/clientes/me"))result=await controller.profile();
            else if(url.endsWith("/cupons/validar"))result=await controller.preview(body,options);
            else if(url.endsWith("/frete"))result=await controller.quote(body);
            else if(url.includes("/cep/"))result=await controller.cep(url.split("/").at(-1));
            else if(url.endsWith("/pedidos"))result=await controller.order(body);
            else if(url.endsWith("/pagamentos"))result=await controller.payment(body);
            else throw Error("Requisição inesperada: "+url);
            return {ok:result.ok,status:result.status||(result.ok?200:400),json:async()=>{if(result.invalidJson)throw new SyntaxError("Unexpected token '<' from private proxy");return result;}};
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../public/js/pages/cart/cart.js"),"utf8"),context);await ready();
    return {nodes,submit,storage,calls,controller,browser,tick:()=>interval(),flushTimers:async()=>{for(const [id,callback] of [...timers]){timers.delete(id);await callback();}},
        setAddress:values=>{Object.entries({...address,...values}).forEach(([key,value])=>nodes.deliveryForm.elements[key].value=value);nodes.deliveryForm.checkValidity=()=>true;},
        input:(key,value)=>{nodes.deliveryForm.elements[key].value=value;nodes.deliveryForm.oninput({target:nodes.deliveryForm.elements[key]});},
        lookup:()=>nodes.deliveryForm.elements.cep.listeners.change(),
        calculate:()=>nodes.deliveryForm.onsubmit(event),submitOrder:()=>nodes.cartForm.onsubmit(event),
        apply:async code=>{nodes.couponForm.elements.codigo.value=code;return nodes.couponForm.onsubmit(event);}};
}
const validQuote=(cents=500)=>({ok:true,data:{token:"quote",frete_centavos:cents,distancia_m:2500,expira_em:new Date(Date.now()+600000).toISOString()}});
async function readyToOrder(p){p.setAddress();p.controller.quote=async()=>validQuote();await p.calculate();}

test("cupom confirma economia e subtotal aparece mesmo sem frete",async()=>{
    const p=await page();assert.match(p.nodes.cartTotal.textContent,/100,00/);assert.equal(p.nodes.cartTotalLabel.textContent,"Subtotal sem frete");assert.equal(p.submit.disabled,true);
    await p.apply("petflow10");assert.match(p.nodes.couponStatus.textContent,/PETFLOW10 aplicado/);assert.match(p.nodes.couponStatus.textContent,/10,00/);assert.match(p.nodes.cartTotal.textContent,/90,00/);assert.equal(p.storage.get("petflow_coupon_code"),"PETFLOW10");
    assert.equal(p.nodes.quoteDelivery.hidden,false);assert.equal(p.submit.disabled,true);
});
test("cupom inválido pode ser removido para restaurar cálculo sem desconto",async()=>{
    const p=await page();await p.apply("BAD");assert.match(p.nodes.couponStatus.textContent,/Cupom indisponível/);assert.equal(p.nodes.removeCoupon.disabled,false);assert.equal(p.submit.disabled,true);
    await p.nodes.removeCoupon.onclick();assert.equal(p.nodes.couponStatus.textContent,"");assert.match(p.nodes.cartTotal.textContent,/100,00/);assert.equal(p.nodes.removeCoupon.disabled,true);assert.equal(p.storage.has("petflow_coupon_code"),false);
});
test("resposta atrasada de cupom não substitui código validado mais recente",async()=>{
    const p=await page();let release;p.controller.preview=body=>body.codigo==="OLD"?new Promise(resolve=>{release=()=>resolve({ok:true,data:{subtotal_centavos:10000,desconto_centavos:2000,codigo:"OLD"}});}):Promise.resolve({ok:true,data:{subtotal_centavos:10000,desconto_centavos:1000,codigo:"NEW"}});
    const old=p.apply("OLD");await p.apply("NEW");release();await old;assert.match(p.nodes.couponStatus.textContent,/NEW aplicado/);assert.match(p.nodes.cartTotal.textContent,/90,00/);assert.equal(p.storage.get("petflow_coupon_code"),"NEW");
});
test("cotação vencida bloqueia finalização e permite recalcular sem ocultar subtotal",async()=>{
    const p=await page();p.setAddress();p.controller.quote=async()=>({...validQuote(),data:{...validQuote().data,expira_em:new Date(Date.now()-1000).toISOString()}});
    await p.calculate();p.tick();assert.equal(p.submit.disabled,true);assert.equal(p.nodes.quoteDelivery.hidden,false);assert.match(p.nodes.deliveryStatus.textContent,/expirou/);assert.match(p.nodes.cartTotal.textContent,/100,00/);
    await p.submitOrder();assert.equal(p.calls.some(call=>call.url.endsWith("/pedidos")),false);
});
test("CEP pendente bloqueia frete e pedido; edição manual descarta resposta tardia",async()=>{
    const p=await page();await readyToOrder(p);let release;p.controller.cep=()=>new Promise(resolve=>{release=()=>resolve({ok:true,data:{...address,endereco:"Rua da resposta antiga"}});});
    p.input("cep","01001000");const lookup=p.lookup();await p.calculate();await p.submitOrder();
    assert.equal(p.submit.disabled,true);assert.equal(p.calls.filter(call=>call.url.endsWith("/frete")).length,1);assert.equal(p.calls.some(call=>call.url.endsWith("/pedidos")),false);
    p.input("endereco","Rua manual escolhida");release();await lookup;assert.equal(p.nodes.deliveryForm.elements.endereco.value,"Rua manual escolhida");await p.flushTimers();assert.equal(p.submit.disabled,false);
});
test("CEP A→B→A considera só a última consulta mesmo quando os valores coincidem",async()=>{
    const p=await page();p.setAddress();p.controller.quote=async()=>validQuote();const releases=[];p.controller.cep=value=>new Promise(resolve=>releases.push(label=>resolve({ok:true,data:{...address,cep:value,endereco:label}})));
    p.input("cep","01001000");const first=p.lookup();p.input("cep","02002000");const second=p.lookup();p.input("cep","01001000");const third=p.lookup();
    releases[2]("Última rua");await third;releases[0]("Primeira rua antiga");await first;releases[1]("Segunda rua antiga");await second;
    assert.equal(p.nodes.deliveryForm.elements.endereco.value,"Última rua");assert.equal(p.calls.filter(call=>call.url.endsWith("/frete")).length,1);
});
test("falha de CEP permite repetir a consulta com o mesmo CEP",async()=>{
    const p=await page();p.setAddress();let calls=0;p.controller.cep=async value=>++calls===1?{ok:false,status:422,message:"CEP indisponível"}:{ok:true,data:{...address,cep:value}};p.controller.quote=async()=>validQuote();
    await p.lookup();assert.match(p.nodes.deliveryStatus.textContent,/CEP indisponível/);await p.lookup();assert.equal(calls,2);assert.equal(p.submit.disabled,false);
});
test("calcular frete manualmente cancela a consulta agendada por digitação",async()=>{
    const p=await page();await readyToOrder(p);p.input("numero","20");await p.calculate();await p.flushTimers();assert.equal(p.calls.filter(call=>call.url.endsWith("/frete")).length,2);
});
test("resposta antiga de frete não substitui endereço novo nem reabilita cotação antiga",async()=>{
    const p=await page();p.setAddress();let release;p.controller.quote=body=>body.endereco.numero==="10"?new Promise(resolve=>{release=()=>resolve(validQuote(100));}):Promise.resolve(validQuote(900));
    const first=p.calculate();p.input("numero","20");await p.calculate();release();await first;
    assert.match(p.nodes.deliveryStatus.textContent,/9,00/);assert.match(p.nodes.cartTotal.textContent,/109,00/);assert.equal(p.submit.disabled,false);
    p.nodes.deliveryForm.elements.numero.value="30";p.tick();assert.equal(p.submit.disabled,true);
});
test("envio congela edição e preserva itens acrescentados externamente durante a requisição",async()=>{
    const p=await page();await readyToOrder(p);let release;p.controller.order=()=>new Promise(resolve=>{release=()=>resolve({ok:true,data:{id:"10000000-0000-0000-0000-000000000001",status:"AGUARDANDO_PAGAMENTO"}});});p.controller.payment=async()=>({ok:false,status:503,message:"PagBank indisponível"});
    const submitting=p.submitOrder();const row=p.nodes.cartItems.children[0],input=row.children[2];assert.equal(input.disabled,true);assert.equal(p.nodes.deliveryForm.elements.endereco.disabled,true);
    input.value="2";input.onchange();await p.apply("NEW");assert.equal(p.calls.filter(call=>call.url.endsWith("/cupons/validar")).length,1);
    p.storage.set("petflow_public_cart",JSON.stringify({product:2}));release();await submitting;
    assert.equal(JSON.parse(p.storage.get("petflow_public_cart")).product,1);assert.equal(p.calls.find(call=>call.url.endsWith("/pedidos")).body.itens[0].quantidade,1);
    assert.match(p.nodes.cartStatus.textContent,/10000000.*PagBank indisponível/);assert.match(p.nodes.cartStatus.children[0].href,/pedido=10000000/);assert.equal(p.storage.has("petflow_order_intent"),false);
});
test("resposta perdida pode ser retomada com mesma chave e snapshot sem cotação atual",async()=>{
    const p=await page();await readyToOrder(p);let attempts=0;p.controller.order=async()=>{if(++attempts===1)throw Error("network lost after commit");return {ok:true,data:{id:"10000000-0000-0000-0000-000000000001",status:"AGUARDANDO_PAGAMENTO"}};};
    await p.submitOrder();assert.equal(p.nodes.recoverOrder.hidden,false);const pending=JSON.parse(p.storage.get("petflow_order_intent"));pending.body.cotacao_frete="expired-original";p.storage.set("petflow_order_intent",JSON.stringify(pending));
    p.input("numero","25");await p.submitOrder();assert.equal(attempts,1);await p.nodes.recoverOrder.onclick();
    const requests=p.calls.filter(call=>call.url.endsWith("/pedidos"));assert.equal(requests.length,2);assert.equal(requests[0].body.chave_pedido,requests[1].body.chave_pedido);assert.equal(requests[1].body.endereco_entrega.numero,"10");assert.equal(p.storage.has("petflow_order_intent"),false);assert.match(p.browser.location.href,/pagamento.pagbank/);
});
test("intenção de outro cliente não é reenviada após troca de sessão",async()=>{
    const storage=new Map([["petflow_public_cart",JSON.stringify({product:1})],["petflow_customer_token","new-session"],["petflow_order_intent",JSON.stringify({customerId:"old-customer",key:"10000000-0000-0000-0000-000000000001",body:{itens:[{produto_id:"product",quantidade:1}],endereco_entrega:address}})]]);
    const p=await page({storage,customerId:"new-customer"});await readyToOrder(p);assert.equal(p.nodes.recoverOrder.hidden,true);await p.submitOrder();assert.notEqual(p.calls.find(call=>call.url.endsWith("/pedidos")).body.chave_pedido,"10000000-0000-0000-0000-000000000001");
});
test("total zerado por cupom e frete grátis não cria pedido",async()=>{
    const p=await page();p.setAddress();p.controller.preview=async()=>({ok:true,data:{subtotal_centavos:10000,desconto_centavos:10000,codigo:"GRATIS"}});p.controller.quote=async()=>validQuote(0);await p.apply("GRATIS");await p.calculate();
    assert.equal(p.submit.disabled,true);assert.match(p.nodes.cartStatus.textContent,/maior que zero/);await p.submitOrder();assert.equal(p.calls.some(call=>call.url.endsWith("/pedidos")),false);
});
test("sessão expirada preserva sacola e exibe login com retorno para sacola",async()=>{
    let calls=0;const p=await page({controller:{preview:async(body,options)=>{calls++;return options.headers.Authorization?{ok:false,status:401,message:"Sessão expirada"}:{ok:true,data:{subtotal_centavos:10000,desconto_centavos:0,codigo:null}};}}});
    assert.equal(calls,2);assert.equal(p.storage.has("petflow_customer_token"),false);assert.match(p.nodes.cartCustomer.children[0].href,/retorno=sacola/);assert.equal(JSON.parse(p.storage.get("petflow_public_cart")).product,1);assert.equal(p.submit.disabled,true);
});
test("resposta não JSON mostra orientação sem expor erro do parser",async()=>{
    const p=await page();p.setAddress();p.controller.quote=async()=>({ok:false,status:502,invalidJson:true});await p.calculate();assert.match(p.nodes.deliveryStatus.textContent,/resposta válida/);assert.doesNotMatch(p.nodes.deliveryStatus.textContent,/Unexpected|private proxy/);assert.equal(p.submit.disabled,true);
});
test("digitar CEP completo bloqueia cotação durante o debounce antes da consulta",async()=>{
    const p=await page();await readyToOrder(p);p.input("cep","01001000");await p.calculate();await p.submitOrder();
    assert.equal(p.submit.disabled,true);assert.equal(p.calls.filter(call=>call.url.endsWith("/frete")).length,1);assert.equal(p.calls.some(call=>call.url.endsWith("/pedidos")),false);
    p.controller.cep=async value=>({ok:true,data:{...address,cep:value}});await p.lookup();assert.equal(p.submit.disabled,false);
});
