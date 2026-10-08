"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
function element(){return {textContent:"",value:"",children:[],disabled:false,hidden:false,append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){},addEventListener(){},classList:{add(){}}};}
async function page(){
    const nodes=Object.fromEntries(["cartItems","cartTotal","cartTotalLabel","cartBreakdown","cartStatus","cartCustomer","couponStatus","deliveryStatus","quoteDelivery","removeCoupon","chooseMore","cartForm","couponForm","deliveryForm"].map(id=>[id,element()]));
    const submit=element();nodes.cartForm.querySelector=()=>submit;nodes.cartForm.elements={observacoes:element()};nodes.couponForm.elements={codigo:element()};
    nodes.deliveryForm.elements=Object.fromEntries(["cep","endereco","numero","complemento","bairro","cidade","estado"].map(key=>[key,element()]));nodes.deliveryForm.checkValidity=()=>false;
    let ready,interval;const storage=new Map([["petflow_public_cart",JSON.stringify({product:1})],["petflow_customer_token","test"]]);const calls=[];
    const controller={preview:async body=>body.codigo==="BAD"?{ok:false,message:"Cupom indisponível."}:{ok:true,data:{subtotal_centavos:10000,desconto_centavos:body.codigo?1000:0,codigo:body.codigo||null}},quote:async()=>({ok:false,message:"Frete indisponível."})};
    const browser={PetFlowPublicHeader:{update(){}}};browser.top=browser;
    const context=vm.createContext({window:browser,parent:browser,location:{search:"",origin:"http://local"},URLSearchParams,Date,FormData:class{constructor(form){return Object.entries(form.elements).map(([key,node])=>[key,node.value]);}},
        document:{getElementById:id=>nodes[id],createElement:()=>element(),addEventListener:(name,callback)=>{if(name==="DOMContentLoaded")ready=callback;},body:element()},
        sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},setInterval:callback=>{interval=callback;},setTimeout:()=>0,clearTimeout(){},
        fetch:async(url,options)=>{const body=options.body?JSON.parse(options.body):{};calls.push({url,body});let result;
            if(url.endsWith("/produtos"))result={ok:true,data:[{id:"product",nome:"Ração",preco:100,estoque_disponivel:10}]};
            else if(url.endsWith("/clientes/me"))result={ok:true,data:{nome:"Cliente"}};
            else if(url.endsWith("/cupons/validar"))result=await controller.preview(body);
            else if(url.endsWith("/frete"))result=await controller.quote(body);
            else throw Error("Requisição inesperada: "+url);
            return {ok:result.ok,json:async()=>result};}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../public/js/pages/cart/cart.js"),"utf8"),context);await ready();
    return {nodes,submit,storage,calls,controller,tick:()=>interval(),apply:async code=>{nodes.couponForm.elements.codigo.value=code;return nodes.couponForm.onsubmit({preventDefault(){}});}};
}
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
    const p=await page();p.nodes.deliveryForm.checkValidity=()=>true;p.controller.quote=async()=>({ok:true,data:{token:"quote",frete_centavos:636,distancia_m:3120,expira_em:new Date(Date.now()-1000).toISOString()}});
    p.nodes.deliveryForm.onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));p.tick();
    assert.equal(p.submit.disabled,true);assert.equal(p.nodes.quoteDelivery.hidden,false);assert.match(p.nodes.deliveryStatus.textContent,/expirou/);assert.match(p.nodes.cartTotal.textContent,/100,00/);
    await p.nodes.cartForm.onsubmit({preventDefault(){}});assert.equal(p.calls.some(call=>call.url.endsWith("/pedidos")),false);
});
