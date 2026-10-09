"use strict";
(()=>{
    const $=id=>document.getElementById(id),token=()=>sessionStorage.getItem("petflow_customer_token");
    const read=(key,fallback)=>{try{return JSON.parse(sessionStorage.getItem(key))||fallback;}catch{return fallback;}};
    const money=cents=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
    const addressFields=["cep","endereco","numero","complemento","bairro","cidade","estado"];
    const address=()=>Object.fromEntries(addressFields.map(key=>[key,$("deliveryForm").elements[key].value]));
    const normalizedAddress=()=>Object.fromEntries(addressFields.map(key=>[key,key==="cep"?address()[key].replace(/\D/g,""):key==="estado"?address()[key].trim().toUpperCase():address()[key].trim().replace(/\s+/g," ")]));
    const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    let products=[],cart=read("petflow_public_cart",{}),quote=null,quoteAddress=null,totals=null,coupon=sessionStorage.getItem("petflow_coupon_code")||"",busy=false,deliveryPending=false,cepPending=false,revision=0,addressRevision=0,cepRevision=0,timer,customerId=null;
    let pendingIntent=read("petflow_order_intent",null),lastCep="",requestedCep="";
    const items=()=>Object.entries(cart).map(([produto_id,quantidade])=>({produto_id,quantidade:Number(quantidade)}));
    const snapshot=()=>({formaPagamento:"PAGBANK",observacoes:$("cartForm").elements.observacoes.value.trim(),itens:items(),cupom_codigo:coupon,cotacao_frete:quote?.token,endereco_entrega:address()});
    function fingerprint(body){
        const cleanAddress=Object.fromEntries(addressFields.map(key=>{const value=String(body.endereco_entrega?.[key]||"").trim().replace(/\s+/g," ");return [key,key==="cep"?value.replace(/\D/g,""):key==="estado"?value.toUpperCase():value];}));
        return JSON.stringify([body.itens.slice().sort((a,b)=>a.produto_id.localeCompare(b.produto_id)),cleanAddress,String(body.cupom_codigo||"").trim().toUpperCase(),String(body.observacoes||"").trim(),body.formaPagamento]);
    }
    function saveIntent(value){pendingIntent=value;if(value)sessionStorage.setItem("petflow_order_intent",JSON.stringify(value));else sessionStorage.removeItem("petflow_order_intent");}
    function validQuote(){return quote&&new Date(quote.expira_em)>new Date()&&quoteAddress===JSON.stringify(normalizedAddress())&&!cepPending;}
    function persist(){sessionStorage.setItem("petflow_public_cart",JSON.stringify(cart));window.PetFlowPublicHeader?.update();if(parent!==window)parent.postMessage({type:"petflow:cart-update"},location.origin);}
    function showVisitor(){
        const link=document.createElement("a");link.href="/login?retorno=sacola";link.target="_top";link.textContent="Entre ou cadastre-se para finalizar";
        $("cartCustomer").replaceChildren(link);
    }
    function expireCustomerSession(){
        customerId=null;
        for(const key of ["petflow_customer_token","petflow_customer_user"]){sessionStorage.removeItem(key);localStorage.removeItem(key);}
        showVisitor();window.PetFlowPublicHeader?.update();summary();
    }
    async function api(path,method="GET",body,authenticated=false) {
        let response,payload;
        try{response=await fetch("/api/public/"+path,{method,headers:{"Content-Type":"application/json",...(authenticated&&token()?{Authorization:"Bearer "+token()}:{})},body:body?JSON.stringify(body):undefined});}
        catch{throw Object.assign(new Error("Não foi possível confirmar a resposta da loja. Verifique sua conexão e tente novamente."),{status:0,uncertain:true});}
        try{payload=await response.json();}
        catch{throw Object.assign(new Error("A loja não retornou uma resposta válida. Tente novamente em instantes."),{status:response.status,uncertain:true});}
        if(!response.ok){
            if(authenticated&&response.status===401)expireCustomerSession();
            throw Object.assign(new Error(typeof payload?.message==="string"?payload.message:"Não foi possível concluir a operação."),{status:response.status});
        }
        return payload;
    }
    function summary() {
        const hasQuote=validQuote(),total=totals?totals.subtotal_centavos-totals.desconto_centavos+(hasQuote?quote.frete_centavos:0):null;
        $("cartTotalLabel").textContent=hasQuote?"Total com frete":"Subtotal sem frete";
        $("cartTotal").textContent=total!=null?money(total):"—";
        $("cartBreakdown").textContent=totals?"Produtos: "+money(totals.subtotal_centavos)+" · Desconto: "+money(totals.desconto_centavos)+(hasQuote?" · Frete: "+money(quote.frete_centavos):" · Frete a calcular"):"";
        for(const id of ["cartItems","deliveryForm","couponForm","cartForm"]){for(const control of $(id).querySelectorAll("input, textarea, button"))control.disabled=busy;}
        $("removeCoupon").disabled=busy||!coupon;
        $("quoteDelivery").disabled=busy||deliveryPending||cepPending;
        if(quote&&new Date(quote.expira_em)<=new Date())$("deliveryStatus").textContent="A cotação expirou. Calcule o frete novamente para finalizar.";
        if(hasQuote&&total<=0)$("cartStatus").textContent="O total precisa ser maior que zero para pagar no PagBank. Ajuste o cupom ou os produtos.";
        const differentIntent=pendingIntent&&pendingIntent.customerId===customerId&&fingerprint(pendingIntent.body)!==fingerprint(snapshot());
        $("cartForm").querySelector("button[type=submit]").disabled=Boolean(busy||!token()||!customerId||!hasQuote||!totals||!items().length||total<=0||differentIntent);
        $("recoverOrder").hidden=!pendingIntent;
        $("recoverOrder").disabled=busy||!token()||pendingIntent?.customerId!==customerId;
    }
    function render(){
        $("cartItems").replaceChildren();
        for(const [id,quantity] of Object.entries(cart)){
            const product=products.find(p=>p.id===id);
            const row=document.createElement("article");row.className="cart-item";
            const image=document.createElement("img");image.src=product?.foto||"/images/logo/petflow-logo.png";image.alt=product?.nome||"Produto indisponível";
            const info=document.createElement("div");const name=document.createElement("strong");name.textContent=product?.nome||"Produto indisponível";const price=document.createElement("span");price.textContent=product?money(Math.round(Number(product.preco)*100)):"Remova este produto";info.append(name,price);
            const input=document.createElement("input");input.className="form-control";input.type="number";input.min="1";input.step="1";input.max=String(Math.min(999,product?.estoque_disponivel||0));input.value=quantity;input.setAttribute("aria-label","Quantidade de "+name.textContent);
            input.onchange=()=>{if(busy)return;const value=Number(input.value);if(!Number.isInteger(value)||value<1||value>Number(input.max)){input.value=quantity;$("cartStatus").textContent="Quantidade indisponível em estoque.";return;}cart[id]=value;persist();render();refreshTotals();};
            const remove=document.createElement("button");remove.type="button";remove.textContent="Remover";remove.onclick=()=>{if(busy)return;delete cart[id];persist();render();refreshTotals();};
            row.append(image,info,input,remove);$("cartItems").append(row);
        }
        if(!items().length)$("cartItems").textContent="Sua sacola está vazia.";
        summary();
    }
    async function refreshTotals(keepStatus=false){
        const version=++revision;totals=null;$("couponStatus").textContent=coupon?"Validando cupom...":"";summary();
        if(!items().length)return;
        try{
            const body={itens:items(),codigo:coupon};let result;
            try{result=await api("cupons/validar","POST",body,true);}
            catch(error){
                if(error.status!==401||version!==revision)throw error;
                result=await api("cupons/validar","POST",body);
            }
            if(version!==revision)return;
            totals=result.data;coupon=totals.codigo||"";
            if(coupon)sessionStorage.setItem("petflow_coupon_code",coupon);else sessionStorage.removeItem("petflow_coupon_code");
            $("couponStatus").textContent=coupon?"Cupom "+coupon+" aplicado. Você economizou "+money(totals.desconto_centavos)+".":"";
            if(!keepStatus)$("cartStatus").textContent="";summary();
        }catch(error){if(version===revision){
            $(coupon?"couponStatus":"cartStatus").textContent=error.message+(coupon?" Corrija o código ou remova o cupom para continuar.":"");summary();
        }}
    }
    async function calculate(){
        if(busy)return;clearTimeout(timer);timer=null;
        if(cepPending){$("deliveryStatus").textContent="Consultando CEP antes de calcular o frete...";summary();return;}
        const version=++addressRevision;quote=null;quoteAddress=null;summary();
        const form=$("deliveryForm");
        if(!form.checkValidity()){deliveryPending=false;$("deliveryStatus").textContent="Complete o endereço para calcular o frete.";summary();return;}
        const current=address(),currentKey=JSON.stringify(normalizedAddress());sessionStorage.setItem("petflow_delivery_address",JSON.stringify(current));
        deliveryPending=true;summary();$("deliveryStatus").textContent="Consultando distância e frete...";
        try{
            const result=await api("frete","POST",{endereco:current});
            if(version!==addressRevision||currentKey!==JSON.stringify(normalizedAddress())||cepPending)return;
            quote=result.data;quoteAddress=currentKey;$("deliveryStatus").textContent="Entrega: "+money(quote.frete_centavos)+" · "+(quote.distancia_m/1000).toFixed(1)+" km";summary();
        }catch(error){if(version===addressRevision)$("deliveryStatus").textContent=error.message;}
        finally{if(version===addressRevision){deliveryPending=false;summary();}}
    }
    async function lookupCep(){
        if(busy)return;clearTimeout(timer);timer=null;
        const value=$("deliveryForm").elements.cep.value.replace(/\D/g,"");
        if(value.length!==8){cepPending=false;$("deliveryStatus").textContent="Informe um CEP com oito dígitos ou complete o endereço.";summary();return;}
        if(cepPending&&requestedCep===value)return;
        if(value===lastCep){cepPending=false;return calculate();}
        const version=++cepRevision;requestedCep=value;cepPending=true;addressRevision++;quote=null;quoteAddress=null;deliveryPending=false;
        $("deliveryStatus").textContent="Consultando CEP...";summary();
        try{
            const result=await api("cep/"+value);
            if(version!==cepRevision||$("deliveryForm").elements.cep.value.replace(/\D/g,"")!==value)return;
            Object.entries(result.data).forEach(([key,value])=>{if($("deliveryForm").elements[key])$("deliveryForm").elements[key].value=value;});
            lastCep=value;cepPending=false;await calculate();
        }catch(error){if(version===cepRevision){cepPending=false;$("deliveryStatus").textContent=error.message;summary();}}
    }
    function statusWithOrders(message,orderId){
        $("cartStatus").textContent=message+" ";
        const link=document.createElement("a");link.href=orderId?"/meus-pedidos?pagamento=retorno&pedido="+encodeURIComponent(orderId):"/meus-pedidos";link.target="_top";link.textContent="Ver Meus pedidos";$("cartStatus").append(link);
    }
    async function submitOrder(recover=false){
        if(busy||!token()||!customerId)return;
        if(recover){if(!pendingIntent||pendingIntent.customerId!==customerId)return;}
        else if(!items().length||!validQuote()||!totals||totals.subtotal_centavos-totals.desconto_centavos+quote.frete_centavos<=0){summary();return;}
        const current=recover?pendingIntent.body:snapshot();
        if(pendingIntent&&pendingIntent.customerId===customerId&&!recover&&fingerprint(pendingIntent.body)!==fingerprint(current)){
            statusWithOrders("Retome o pedido anterior para confirmar o resultado antes de enviar os novos dados.");return;
        }
        const body={...current,chave_pedido:pendingIntent?.customerId===customerId?pendingIntent.key:crypto.randomUUID()};
        saveIntent({customerId,key:body.chave_pedido,body});
        busy=true;clearTimeout(timer);summary();let orderId;
        try{
            const result=await api("pedidos","POST",body,true),order=result.data;
            if(!UUID.test(order?.id||""))throw Object.assign(new Error("A loja não confirmou a referência do pedido. Retome o pedido anterior."),{uncertain:true});
            orderId=order.id;saveIntent(null);
            if(order.status==="CANCELADA"){
                statusWithOrders("O pedido anterior foi cancelado ou sua reserva expirou. Calcule o frete novamente para fazer uma nova compra.",orderId);quote=null;quoteAddress=null;return;
            }
            cart=read("petflow_public_cart",cart);
            for(const item of body.itens){const remaining=Number(cart[item.produto_id]||0)-item.quantidade;if(remaining>0)cart[item.produto_id]=remaining;else delete cart[item.produto_id];}
            persist();revision++;totals=null;render();if(items().length)await refreshTotals(true);
            if(order.status!=="AGUARDANDO_PAGAMENTO"){statusWithOrders("Pedido anterior recuperado. Confira sua situação em Meus pedidos.",orderId);return;}
            $("cartStatus").textContent="Pedido criado. Abrindo pagamento...";
            const payment=await api("pagamentos","POST",{vendaId:orderId},true);let target;
            try{target=new URL(payment.payment?.checkoutUrl||"");}catch{throw new Error("Pedido criado. Acesse Meus pedidos para continuar o pagamento.");}
            if(target.protocol!=="https:")throw new Error("Pedido criado. Acesse Meus pedidos para continuar o pagamento.");
            window.top.location.href=target.href;
        }catch(error){
            if(!orderId&&(error.status===400||error.status===422)&&!error.uncertain)saveIntent(null);
            statusWithOrders(orderId?"Pedido #"+orderId.slice(0,8).toUpperCase()+": "+error.message:error.message+(pendingIntent?" Retome o pedido anterior para confirmar seu resultado.":""),orderId);
        }finally{busy=false;summary();}
    }
    document.addEventListener("DOMContentLoaded",async()=>{
        if(new URLSearchParams(location.search).get("sidebar")==="1")document.body.classList.add("in-cart-sidebar");
        $("chooseMore").onclick=event=>{if(busy){event.preventDefault();return;}if(parent!==window){event.preventDefault();parent.postMessage({type:"petflow:cart-close"},location.origin);}};
        $("deliveryForm").onsubmit=event=>{event.preventDefault();return calculate();};
        $("deliveryForm").oninput=event=>{
            if(busy)return;addressRevision++;cepRevision++;cepPending=false;quote=null;quoteAddress=null;deliveryPending=false;$("deliveryStatus").textContent="Endereço alterado. Atualizando frete...";summary();clearTimeout(timer);
            const cepChanged=event?.target===$("deliveryForm").elements.cep;
            if(cepChanged){requestedCep="";cepPending=$("deliveryForm").elements.cep.value.replace(/\D/g,"").length===8;summary();}
            sessionStorage.setItem("petflow_delivery_address",JSON.stringify(address()));
            timer=setTimeout(cepChanged?lookupCep:calculate,700);
        };
        $("deliveryForm").elements.cep.addEventListener("change",lookupCep);
        $("couponForm").elements.codigo.value=coupon;
        $("couponForm").onsubmit=event=>{event.preventDefault();if(busy)return;coupon=$("couponForm").elements.codigo.value.trim().toUpperCase();return refreshTotals();};
        $("removeCoupon").onclick=()=>{if(busy)return;coupon="";$("couponForm").elements.codigo.value="";sessionStorage.removeItem("petflow_coupon_code");return refreshTotals();};
        $("cartForm").onsubmit=event=>{event.preventDefault();return submitOrder();};
        $("recoverOrder").onclick=()=>submitOrder(true);
        try{
            products=(await api("produtos")).data;render();
            let saved=read("petflow_delivery_address",null);
            if(token()){
                try{
                    const profile=(await api("clientes/me","GET",undefined,true)).data;customerId=profile.id;
                    $("cartCustomer").textContent="Pedido de "+profile.nome;
                    saved=saved||profile;
                    if(pendingIntent&&pendingIntent.customerId!==customerId)saveIntent(null);
                }catch(error){if(error.status!==401)throw error;}
            }
            if(!token())showVisitor();
            if(saved)Object.entries(saved).forEach(([key,value])=>{if($("deliveryForm").elements[key])$("deliveryForm").elements[key].value=value||"";});
            await refreshTotals();await calculate();
            if(pendingIntent)statusWithOrders("Há um envio de pedido sem resposta confirmada. Retome o pedido anterior para conferir o resultado.");
        }catch(error){$("cartStatus").textContent=error.message;}
        summary();setInterval(summary,15000);
    });
})();
