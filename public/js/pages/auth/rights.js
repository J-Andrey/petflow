"use strict";
(()=>{
    const token=sessionStorage.getItem("petflow_customer_token");
    if(!token){location.href="/login";return;}
    const form=document.getElementById("requestForm"),status=document.getElementById("status");
    async function request(path,options={}) {
        const response=await fetch(path.startsWith("/api/")?path:"/api/public/clientes/"+path,{...options,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}});
        if(!response.ok)throw new Error((await response.json()).message||"Não foi possível concluir a operação.");
        return response;
    }
    function types() {
        const lgpd=form.elements.categoria.value==="lgpd";
        form.elements.tipo.replaceChildren();
        (lgpd?["ACESSO","CORRECAO","ANONIMIZACAO","EXCLUSAO","PORTABILIDADE","REVOGACAO","INFORMACAO"]:["CANCELAMENTO","ARREPENDIMENTO","DEVOLUCAO","RECLAMACAO"]).forEach(type=>{
            const option=document.createElement("option");option.value=type;option.textContent=type;form.elements.tipo.append(option);
        });
        document.getElementById("orderLabel").hidden=lgpd;form.elements.venda_id.required=!lgpd;
    }
    async function load() {
        const data=await (await request("direitos/solicitacoes")).json();
        const list=document.getElementById("requests");list.replaceChildren();
        [...data.data.lgpd,...data.data.atendimento].forEach(item=>{
            const article=document.createElement("article");
            for(const text of [item.protocolo+" · "+item.tipo+" · "+item.status,"Prazo interno: "+new Date(item.prazo_em).toLocaleDateString("pt-BR"),item.detalhes||item.motivo,item.resposta||"Aguardando resposta."]){
                const p=document.createElement("p");p.textContent=text;article.append(p);
            }list.append(article);
        });
        if(!list.children.length)list.textContent="Você ainda não possui solicitações.";
    }
    form.elements.categoria.onchange=types;types();
    form.onsubmit=async event=>{
        event.preventDefault();const button=form.querySelector("button");button.disabled=true;
        try {
            const data=Object.fromEntries(new FormData(form));
            const cancel=data.categoria==="atendimento"&&data.tipo==="CANCELAMENTO";
            const result=await (await request(cancel?"/api/cancelamentos/cliente/"+data.venda_id:"direitos/solicitacoes",{method:"POST",body:JSON.stringify(cancel?{motivo:data.detalhes}:data)})).json();
            status.textContent=cancel?result.data.status==="CANCELADA"?"Pedido cancelado.":result.data.protocolo?"Atendimento aberto: "+result.data.protocolo:result.data.message||"Reembolso em processamento. Consulte novamente.":result.message;form.elements.detalhes.value="";await load();}
        catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    };
    document.getElementById("export").onclick=async()=>{
        try{const blob=await (await request("direitos/exportacao")).blob();const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="petflow-dados.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
        catch(error){status.textContent=error.message;}
    };
    (async()=>{try{
        const result=await (await request("pedidos")).json();
        result.data.forEach(order=>{const option=document.createElement("option");option.value=order.id;option.textContent=order.id.slice(0,8)+" · "+order.status;form.elements.venda_id.append(option);});
        await load();
    }catch(error){status.textContent=error.message;}})();
})();
