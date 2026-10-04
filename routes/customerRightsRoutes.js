"use strict";
const router=require("express").Router();
const db=require("../database/connection");
const crypto=require("node:crypto");
const {UUID}=require("../services/sessionService");
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.use(require("../middlewares/customerAuthMiddleware"));
router.get("/solicitacoes",wrap(async(req,res)=>{
    const params=[req.customer.id,req.customer.empresaId];
    const lgpd=await db.query("SELECT protocolo,tipo,status,detalhes,resposta,solicitada_em,prazo_em FROM lgpd_solicitacoes WHERE cliente_id=$1 AND empresa_id=$2 ORDER BY solicitada_em DESC LIMIT 100",params);
    const atendimento=await db.query("SELECT protocolo,venda_id,tipo,status,motivo,resposta,solicitada_em,prazo_em FROM solicitacoes_consumidor WHERE cliente_id=$1 AND empresa_id=$2 ORDER BY solicitada_em DESC LIMIT 100",params);
    res.json({success:true,data:{lgpd:lgpd.rows,atendimento:atendimento.rows}});
}));
router.post("/solicitacoes",wrap(async(req,res)=>{
    const {categoria,tipo,detalhes,venda_id}=req.body;
    const types=categoria==="lgpd"?["ACESSO","CORRECAO","ANONIMIZACAO","EXCLUSAO","PORTABILIDADE","REVOGACAO","INFORMACAO"]:["CANCELAMENTO","ARREPENDIMENTO","DEVOLUCAO","RECLAMACAO"];
    if(!["lgpd","atendimento"].includes(categoria)||!types.includes(tipo)||typeof detalhes!=="string"||detalhes.trim().length<5||detalhes.length>1000)
        return res.status(400).json({success:false,message:"Informe o tipo e detalhes entre 5 e 1000 caracteres."});
    const protocolo=(categoria==="lgpd"?"LGPD-":"SAC-")+crypto.randomBytes(10).toString("hex").toUpperCase();
    await db.transaction(async client=>{
        if(categoria==="atendimento") {
            if(!UUID.test(venda_id)) throw Object.assign(new Error("Pedido inválido."),{status:400});
            const order=await client.query("SELECT id FROM vendas WHERE id=$1 AND cliente_id=$2 AND empresa_id=$3 FOR UPDATE",[venda_id,req.customer.id,req.customer.empresaId]);
            if(!order.rowCount) throw Object.assign(new Error("Pedido não encontrado."),{status:404});
            await client.query("INSERT INTO solicitacoes_consumidor(protocolo,empresa_id,cliente_id,venda_id,email_referencia,tipo,motivo) VALUES($1,$2,$3,$4,$5,$6,$7)",
                [protocolo,req.customer.empresaId,req.customer.id,venda_id,req.customer.email,tipo,detalhes.trim()]);
        } else {
            await client.query("INSERT INTO lgpd_solicitacoes(protocolo,empresa_id,cliente_id,email_referencia,tipo,detalhes) VALUES($1,$2,$3,$4,$5,$6)",
                [protocolo,req.customer.empresaId,req.customer.id,req.customer.email,tipo,detalhes.trim()]);
        }
    });
    res.status(201).json({success:true,protocolo,message:"Solicitação registrada: "+protocolo});
}));
router.get("/exportacao",wrap(async(req,res)=>{
    const data=await db.transaction(async client=>{
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const params=[req.customer.id,req.customer.empresaId];
        const profile=await client.query("SELECT nome,cpf,email,telefone,whatsapp,cep,endereco,numero,complemento,bairro,cidade,estado,data_nascimento,privacidade_versao,privacidade_aceita_em FROM clientes WHERE id=$1 AND empresa_id=$2",params);
        const pets=await client.query("SELECT id,nome,especie,raca,sexo,porte,peso,observacoes FROM pets WHERE cliente_id=$1 AND empresa_id=$2",params);
        const appointments=await client.query("SELECT id,servico,data_agendamento,horario,status FROM agendamentos WHERE cliente_id=$1 AND empresa_id=$2",params);
        const orders=await client.query("SELECT id,data_venda,status,valor_total,valor_final FROM vendas WHERE cliente_id=$1 AND empresa_id=$2",params);
        const consents=await client.query("SELECT finalidade,versao,concedido,origem,created_at FROM lgpd_consentimentos WHERE cliente_id=$1 AND empresa_id=$2",params);
        return {perfil:profile.rows[0],pets:pets.rows,agendamentos:appointments.rows,pedidos:orders.rows,consentimentos:consents.rows,
            observacao:"Para cópia de prontuários, anexos ou outros registros, solicite ACESSO ou PORTABILIDADE pelo atendimento de privacidade."};
    });
    res.set("Cache-Control","no-store").attachment("petflow-dados.json").json(data);
}));
module.exports=router;
