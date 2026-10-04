"use strict";
(()=>{
    const $=id=>document.getElementById(id),token=()=>sessionStorage.getItem("petflow_customer_token");
    const read=(key,fallback)=>{try{return JSON.parse(sessionStorage.getItem(key))||fallback;}catch{return fallback;}};
    const money=cents=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
    let products=[],cart=read("petflow_public_cart",{}),quote=null,totals=null,coupon="",busy=false,revision=0,timer;
    const address=()=>Object.fromEntries(new FormData($("deliveryForm")));
    const items=()=>Object.entries(cart).map(([produto_id,quantidade])=>({produto_id,quantidade:Number(quantidade)}));
    function persist(){sessionStorage.setItem("petflow_public_cart",JSON.stringify(cart));window.PetFlowPublicHeader?.update();if(parent!==window)parent.postMessage({type:"petflow:cart-update"},location.origin);}
    async function api(path,method="GET",body,authenticated=false) {
        const response=await fetch("/api/public/"+path,{method,headers:{"Content-Type":"application/json",...(authenticated&&token()?{Authorization:"Bearer "+token()}:{})},body:body?JSON.stringify(body):undefined});
        const payload=await response.json();if(!response.ok)throw new Error(payload.message||"Não foi possível concluir a operação.");return payload;
    }
    function summary() {
        const validQuote=quote&&new Date(quote.expira_em)>new Date();
        $("cartTotal").textContent=validQuote&&totals?money(totals.subtotal_centavos-totals.desconto_centavos+quote.frete_centavos):"—";
        $("cartBreakdown").textContent=totals?"Produtos: "+money(totals.subtotal_centavos)+" · Desconto: "+money(totals.desconto_centavos)+" · Subtotal: "+money(totals.subtotal_centavos-totals.desconto_centavos)+(validQuote?" · Frete: "+money(quote.frete_centavos):"")+" · Economia: "+money(totals.desconto_centavos):"";
        $("cartForm").querySelector("button[type=submit]").disabled=busy||!token()||!validQuote||!totals||!items().length;
    }
    function render(){
        $("cartItems").replaceChildren();
        for(const [id,quantity] of Object.entries(cart)){
            const product=products.find(p=>p.id===id);
            const row=document.createElement("article");row.className="cart-item";
            const image=document.createElement("img");image.src=product?.foto||"/images/logo/petflow-logo.png";image.alt=product?.nome||"Produto indisponível";
            const info=document.createElement("div");const name=document.createElement("strong");name.textContent=product?.nome||"Produto indisponível";const price=document.createElement("span");price.textContent=product?money(Math.round(Number(product.preco)*100)):"Remova este produto";info.append(name,price);
            const input=document.createElement("input");input.className="form-control";input.type="number";input.min="1";input.step="1";input.max=String(product?.estoque_disponivel||0);input.value=quantity;input.setAttribute("aria-label","Quantidade de "+name.textContent);
            input.onchange=()=>{const value=Number(input.value);if(!Number.isInteger(value)||value<1||value>Number(input.max)){input.value=quantity;$("cartStatus").textContent="Quantidade indisponível em estoque.";return;}cart[id]=value;persist();render();refreshTotals();};
            const remove=document.createElement("button");remove.type="button";remove.textContent="Remover";remove.onclick=()=>{delete cart[id];persist();render();refreshTotals();};
            row.append(image,info,input,remove);$("cartItems").append(row);
        }
        if(!items().length)$("cartItems").textContent="Sua sacola está vazia.";
        summary();
    }
    async function refreshTotals(){
        const version=++revision;totals=null;summary();
        if(!items().length)return;
        try{
            const result=await api("cupons/validar","POST",{itens:items(),codigo:coupon},true);
            if(version!==revision)return;
            totals=result.data;$("cartStatus").textContent="";summary();
        }catch(error){if(version===revision){$("cartStatus").textContent=error.message;summary();}}
    }
    let addressRevision=0;
    async function calculate(){
        const version=++addressRevision;quote=null;summary();
        const form=$("deliveryForm");
        if(!form.checkValidity()){$("quoteDelivery").hidden=false;return;}
        const current=address();sessionStorage.setItem("petflow_delivery_address",JSON.stringify(current));
        $("quoteDelivery").hidden=!!token();$("deliveryStatus").textContent="Consultando distância e frete...";
        try{
            const result=await api("frete","POST",{endereco:current});
            if(version!==addressRevision)return;
            quote=result.data;$("deliveryStatus").textContent="Entrega: "+money(quote.frete_centavos)+" · "+(quote.distancia_m/1000).toFixed(1)+" km";summary();
        }catch(error){if(version===addressRevision){$("deliveryStatus").textContent=error.message;$("quoteDelivery").hidden=false;summary();}}
    }
    document.addEventListener("DOMContentLoaded",async()=>{
        if(new URLSearchParams(location.search).get("sidebar")==="1")document.body.classList.add("in-cart-sidebar");
        $("chooseMore").onclick=event=>{if(parent!==window){event.preventDefault();parent.postMessage({type:"petflow:cart-close"},location.origin);}};
        $("deliveryForm").onsubmit=event=>{event.preventDefault();calculate();};
        $("deliveryForm").oninput=()=>{
            addressRevision++;quote=null;summary();clearTimeout(timer);
            sessionStorage.setItem("petflow_delivery_address",JSON.stringify(address()));
            timer=setTimeout(calculate,700);
        };
        let lastCep="";
        $("deliveryForm").elements.cep.addEventListener("change",async()=>{
            const value=$("deliveryForm").elements.cep.value.replace(/\D/g,"");
            if(value.length!==8||value===lastCep)return;lastCep=value;
            try{
                const result=await api("cep/"+value);
                if($("deliveryForm").elements.cep.value.replace(/\D/g,"")!==value)return;
                Object.entries(result.data).forEach(([key,value])=>{if($("deliveryForm").elements[key])$("deliveryForm").elements[key].value=value;});
                calculate();
            }catch(error){$("deliveryStatus").textContent=error.message;}
        });
        $("couponForm").onsubmit=event=>{event.preventDefault();coupon=$("couponForm").elements.codigo.value.trim().toUpperCase();refreshTotals();};
        $("cartForm").onsubmit=async event=>{
            event.preventDefault();if(busy||!quote||!totals)return;busy=true;summary();
            try{
                const order=await api("pedidos","POST",{formaPagamento:"PAGBANK",observacoes:$("cartForm").elements.observacoes.value,itens:items(),cupom_codigo:coupon,cotacao_frete:quote.token,endereco_entrega:address()},true);
                cart={};persist();render();totals=null;
                $("cartStatus").textContent="Pedido criado. Abrindo pagamento...";
                const payment=await api("pagamentos","POST",{vendaId:order.data.id},true);
                if(!payment.payment?.checkoutUrl)throw new Error("Pedido criado. Acesse Meus pedidos para continuar o pagamento.");
                window.top.location.href=payment.payment.checkoutUrl;
            }catch(error){$("cartStatus").textContent=error.message;}finally{busy=false;summary();}
        };
        try{
            products=(await api("produtos")).data;render();
            let saved=read("petflow_delivery_address",null);
            if(token()){
                const profile=(await api("clientes/me","GET",undefined,true)).data;
                $("cartCustomer").textContent="Pedido de "+profile.nome;
                saved=saved||profile;
            }else{
                const link=document.createElement("a");link.href="/login?retorno=sacola";link.target="_top";link.textContent="Entre ou cadastre-se para finalizar";$("cartCustomer").append(link);
            }
            if(saved)Object.entries(saved).forEach(([key,value])=>{if($("deliveryForm").elements[key])$("deliveryForm").elements[key].value=value||"";});
            await refreshTotals();await calculate();
        }catch(error){$("cartStatus").textContent=error.message;}
        setInterval(summary,15000);
    });
})();

