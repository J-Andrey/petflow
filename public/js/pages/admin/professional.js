"use strict";
(()=>{
    const token=sessionStorage.getItem("token");
    if(!token) { location.href="/admin/index.html"; return; }
    const $=id=>document.getElementById(id);
    let view="usuarios",page=1,records=[];
    const titles={usuarios:"Usuários",auditoria:"Auditoria",atendimento:"Atendimento",lgpd:"Privacidade",notificacoes:"Notificações"};
    const columns={usuarios:["nome","email","perfil","ativo"],auditoria:["created_at","usuario","acao","entidade","descricao"],
        atendimento:["protocolo","tipo","status","prazo_em"],lgpd:["protocolo","tipo","status","prazo_em"],notificacoes:["titulo","mensagem","enviada_em","lida_em"]};
    async function api(path,method="GET",data) {
        const result=await fetch("/api/"+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:data?JSON.stringify(data):undefined});
        const body=await result.json();
        if(result.status===401) { sessionStorage.removeItem("token"); location.href="/admin/index.html"; }
        if(!result.ok) throw new Error(body.message||"Não foi possível concluir a operação.");
        return body;
    }
    function cell(text,tag="td") {const item=document.createElement(tag);item.textContent=text??"—";return item;}
    async function load() {
        $("status").textContent="Carregando...";
        $("heading").textContent=titles[view];$("newUser").hidden=view!=="usuarios";$("editor").hidden=true;
        try {
            const result=await api(view+"?page="+page+"&q="+encodeURIComponent($("search").value));
            records=result.data; $("head").replaceChildren(); $("rows").replaceChildren();
            const head=document.createElement("tr");columns[view].forEach(key=>head.append(cell(key.replaceAll("_"," "),"th")));head.append(cell("Ações","th"));$("head").append(head);
            records.forEach(record=>{
                const row=document.createElement("tr");
                columns[view].forEach(key=>row.append(cell(typeof record[key]==="boolean"?(record[key]?"Sim":"Não"):record[key])));
                const action=cell("");const button=document.createElement("button");button.textContent=view==="notificacoes"?"Marcar lida":"Abrir";
                button.disabled=view==="notificacoes"&&!!record.lida_em;
                button.onclick=()=>open(record);action.append(button);row.append(action);$("rows").append(row);
            });
            $("unread").textContent=result.naoLidas===undefined?"":result.naoLidas;
            $("page").textContent="Página "+page;$("previous").disabled=page===1;$("next").disabled=records.length<25;
            $("status").textContent=records.length?records.length+" registro(s) nesta página.":"Nenhum registro encontrado.";
        }catch(error){$("status").textContent=error.message;$("rows").replaceChildren();}
    }
    function field(name,label,value="",type="text",options) {
        const wrapper=document.createElement("label");wrapper.textContent=label;
        const input=document.createElement(options?"select":type==="textarea"?"textarea":"input");input.name=name;
        if(options) options.forEach(item=>{const option=document.createElement("option");option.value=item;option.textContent=item;input.append(option);});
        else input.type=type;
        input.value=value??"";input.required=true;
        wrapper.append(input);$("editorForm").append(wrapper);return input;
    }
    async function open(record) {
        if(view==="notificacoes") {
            try {await api(view+"/"+record.id+"/lida","PATCH",{});await load();}catch(error){$("status").textContent=error.message;}return;
        }
        $("editor").hidden=false;$("editorForm").replaceChildren();$("editorTitle").textContent=record?.protocolo||record?.nome||"Novo usuário";
        if(view==="auditoria") {const pre=document.createElement("pre");pre.textContent=JSON.stringify(record,null,2);$("editorForm").append(pre);return;}
        if(view==="usuarios") {
            field("nome","Nome",record?.nome);field("email","E-mail",record?.email,"email");
            field("perfil","Perfil",record?.perfil||"GERENTE","select",["ADMIN","GERENTE"]);
            field("ativo","Ativo",String(record?.ativo??true),"select",["true","false"]);
            const password=field("senha",record?"Nova senha (opcional)":"Senha","","password");password.required=!record;password.minLength=8;password.maxLength=72;password.autocomplete="new-password";
        }else{
            const details=document.createElement("p");details.textContent=record.detalhes||record.motivo;$("editorForm").append(details);
            field("status","Status",record.status,"select",view==="lgpd"?["ABERTA","EM_ANALISE","ATENDIDA","NEGADA"]:["RECEBIDA","EM_ANALISE","ATENDIDA","NEGADA"]);
            const answer=field("resposta","Resposta ao cliente",record.resposta,"textarea");answer.maxLength=2000;answer.minLength=5;
        }
        const save=document.createElement("button");save.textContent="Salvar";$("editorForm").append(save);
        $("editorForm").onsubmit=async event=>{
            event.preventDefault();save.disabled=true;
            try{
                const body=Object.fromEntries(new FormData(event.target));if(view==="usuarios") body.ativo=body.ativo==="true";
                await api(view+(record?"/"+record.id:""),view==="usuarios"?(record?"PUT":"POST"):"PATCH",body);
                await load();$("status").textContent="Dados salvos.";
            }catch(error){$("status").textContent=error.message;}finally{save.disabled=false;}
        };
        $("editor").scrollIntoView({behavior:"smooth"});
    }
    document.querySelectorAll("[data-view]").forEach(button=>button.onclick=()=>{view=button.dataset.view;page=1;load();});
    $("searchForm").onsubmit=event=>{event.preventDefault();page=1;load();};
    $("newUser").onclick=()=>open(null);$("closeEditor").onclick=()=>{$("editor").hidden=true;};
    $("previous").onclick=()=>{page--;load();};$("next").onclick=()=>{page++;load();};load();
})();
