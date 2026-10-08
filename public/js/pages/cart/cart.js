"use strict";
(()=>{
    const $=id=>document.getElementById(id),token=()=>sessionStorage.getItem("petflow_customer_token");
    const read=(key,fallback)=>{try{return JSON.parse(sessionStorage.getItem(key))||fallback;}catch{return fallback;}};
    const money=cents=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
    let products=[],cart=read("petflow_public_cart",{}),quote=null,totals=null,coupon=sessionStorage.getItem("petflow_coupon_code")||"",busy=false,deliveryPending=false,revision=0,timer;
    const address=()=>Object.fromEntries(new FormData($("deliveryForm")));
    const items=()=>Object.entries(cart).map(([produto_id,quantidade])=>({produto_id,quantidade:Number(quantidade)}));
    function persist(){sessionStorage.setItem("petflow_public_cart",JSON.stringify(cart));window.PetFlowPublicHeader?.update();if(parent!==window)parent.postMessage({type:"petflow:cart-update"},location.origin);}
    function showVisitor(){
        const link=document.createElement("a");link.href="/login?retorno=sacola";link.target="_top";link.textContent="Entre ou cadastre-se para finalizar";
        $("cartCustomer").replaceChildren(link);
    }
    function expireCustomerSession(){
        for(const key of ["petflow_customer_token","petflow_customer_user"]){sessionStorage.removeItem(key);localStorage.removeItem(key);}
        showVisitor();window.PetFlowPublicHeader?.update();summary();
    }
    async function api(path,method="GET",body,authenticated=false) {
        const response=await fetch("/api/public/"+path,{method,headers:{"Content-Type":"application/json",...(authenticated&&token()?{Authorization:"Bearer "+token()}:{})},body:body?JSON.stringify(body):undefined});
        const payload=await response.json();
        if(!response.ok){
            if(authenticated&&response.status===401)expireCustomerSession();
            throw Object.assign(new Error(payload.message||"Não foi possível concluir a operação."),{status:response.status});
        }
        return payload;
    }
    function summary() {
        const validQuote=quote&&new Date(quote.expira_em)>new Date();
        $("cartTotalLabel").textContent=validQuote?"Total com frete":"Subtotal sem frete";
        $("cartTotal").textContent=totals?money(totals.subtotal_centavos-totals.desconto_centavos+(validQuote?quote.frete_centavos:0)):"—";
        $("cartBreakdown").textContent=totals?"Produtos: "+money(totals.subtotal_centavos)+" · Desconto: "+money(totals.desconto_centavos)+(validQuote?" · Frete: "+money(quote.frete_centavos):" · Frete a calcular"):"";
        $("removeCoupon").disabled=busy||!coupon;
        $("quoteDelivery").disabled=busy||deliveryPending;
        if(quote&&!validQuote)$("deliveryStatus").textContent="A cotação expirou. Calcule o frete novamente para finalizar.";
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
        const version=++revision;totals=null;$("couponStatus").textContent=coupon?"Validando cupom...":"";summary();
        if(!items().length)return;
        try{
            const body={itens:items(),codigo:coupon};let result;
            try{result=await api("cupons/validar","POST",body,true);}
            catch(error){
                if(error.status!==401||version!==revision)throw error;
                // A prévia não cria pedidos: pode ser consultada uma vez como visitante.
                result=await api("cupons/validar","POST",body);
            }
            if(version!==revision)return;
            totals=result.data;coupon=totals.codigo||"";
            if(coupon)sessionStorage.setItem("petflow_coupon_code",coupon);else sessionStorage.removeItem("petflow_coupon_code");
            $("couponStatus").textContent=coupon?"Cupom "+coupon+" aplicado. Você economizou "+money(totals.desconto_centavos)+".":"";
            $("cartStatus").textContent="";summary();
        }catch(error){if(version===revision){
            $(coupon?"couponStatus":"cartStatus").textContent=error.message+(coupon?" Corrija o código ou remova o cupom para continuar.":"");summary();
        }}
    }
    let addressRevision=0;
    async function calculate(){
        const version=++addressRevision;quote=null;summary();
        const form=$("deliveryForm");
        if(!form.checkValidity()){deliveryPending=false;$("deliveryStatus").textContent="Complete o endereço para calcular o frete.";summary();return;}
        const current=address();sessionStorage.setItem("petflow_delivery_address",JSON.stringify(current));
        deliveryPending=true;summary();$("deliveryStatus").textContent="Consultando distância e frete...";
        try{
            const result=await api("frete","POST",{endereco:current});
            if(version!==addressRevision)return;
            quote=result.data;$("deliveryStatus").textContent="Entrega: "+money(quote.frete_centavos)+" · "+(quote.distancia_m/1000).toFixed(1)+" km";summary();
        }catch(error){if(version===addressRevision)$("deliveryStatus").textContent=error.message;}
        finally{if(version===addressRevision){deliveryPending=false;summary();}}
    }
    document.addEventListener("DOMContentLoaded",async()=>{
        if(new URLSearchParams(location.search).get("sidebar")==="1")document.body.classList.add("in-cart-sidebar");
        $("chooseMore").onclick=event=>{if(parent!==window){event.preventDefault();parent.postMessage({type:"petflow:cart-close"},location.origin);}};
        $("deliveryForm").onsubmit=event=>{event.preventDefault();calculate();};
        $("deliveryForm").oninput=()=>{
            addressRevision++;quote=null;deliveryPending=false;$("deliveryStatus").textContent="Endereço alterado. Atualizando frete...";summary();clearTimeout(timer);
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
        $("couponForm").elements.codigo.value=coupon;
        $("couponForm").onsubmit=event=>{event.preventDefault();coupon=$("couponForm").elements.codigo.value.trim().toUpperCase();return refreshTotals();};
        $("removeCoupon").onclick=()=>{coupon="";$("couponForm").elements.codigo.value="";sessionStorage.removeItem("petflow_coupon_code");return refreshTotals();};
        $("cartForm").onsubmit=async event=>{
            event.preventDefault();if(busy||!token()||!items().length||!quote||new Date(quote.expira_em)<=new Date()||!totals){summary();return;}busy=true;summary();
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
                try{
                    const profile=(await api("clientes/me","GET",undefined,true)).data;
                    $("cartCustomer").textContent="Pedido de "+profile.nome;
                    saved=saved||profile;
                }catch(error){if(error.status!==401)throw error;}
            }
            if(!token())showVisitor();
            if(saved)Object.entries(saved).forEach(([key,value])=>{if($("deliveryForm").elements[key])$("deliveryForm").elements[key].value=value||"";});
            await refreshTotals();await calculate();
        }catch(error){$("cartStatus").textContent=error.message;}
        setInterval(summary,15000);
    });
})();

