"use strict";
const router=require("express").Router();
const db=require("../database/connection");
const auth=require("../middlewares/authMiddleware");
const role=require("../middlewares/roleMiddleware");
const users=require("../services/adminUserService");
const audit=require("../services/auditService");
const {UUID}=require("../services/sessionService");
const {sendOptionalEmail}=require("../services/emailService");
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const page=req=>Math.max(1,Math.min(10000,Number.parseInt(req.query.page,10)||1));
router.use(auth);
router.param("id",(req,res,next,id)=>UUID.test(id)?next():res.status(400).json({success:false,message:"Identificador inválido."}));
router.get("/usuarios",role("ADMIN"),wrap(async(req,res)=>{
    const result=await db.query("SELECT id,nome,email,perfil,ativo,ultimo_login,COUNT(*) OVER() AS total FROM usuarios WHERE empresa_id=$1 AND (nome ILIKE $2 OR email ILIKE $2) ORDER BY nome,id LIMIT 25 OFFSET $3",
        [req.user.empresaId,"%"+String(req.query.q||"").slice(0,100)+"%",(page(req)-1)*25]);
    res.json({success:true,data:result.rows,page:page(req)});
}));
router.post("/usuarios",role("ADMIN"),wrap(async(req,res)=>res.status(201).json({success:true,data:await users.save(db,req)})));
router.put("/usuarios/:id",role("ADMIN"),wrap(async(req,res)=>res.json({success:true,data:await users.save(db,req,req.params.id)})));
router.get("/auditoria",role("ADMIN"),wrap(async(req,res)=>{
    const result=await db.query(`SELECT a.*,u.nome AS usuario,COUNT(*) OVER() AS total FROM auditoria_admin a
        LEFT JOIN usuarios u ON u.id=a.usuario_id AND u.empresa_id=a.empresa_id
        WHERE a.empresa_id=$1 AND (a.acao ILIKE $2 OR a.entidade ILIKE $2 OR a.descricao ILIKE $2)
        ORDER BY a.created_at DESC,a.id LIMIT 25 OFFSET $3`,
        [req.user.empresaId,"%"+String(req.query.q||"").slice(0,100)+"%",(page(req)-1)*25]);
    res.json({success:true,data:result.rows,page:page(req)});
}));
router.get("/notificacoes",wrap(async(req,res)=>{
    const result=await db.query(`SELECT n.*,l.lida_em,COUNT(*) OVER() AS total FROM notificacoes_admin n
        LEFT JOIN notificacoes_admin_leituras l ON l.notificacao_id=n.id AND l.usuario_id=$2
        WHERE n.empresa_id=$1 ORDER BY n.enviada_em DESC,n.id LIMIT 25 OFFSET $3`,
        [req.user.empresaId,req.user.id,(page(req)-1)*25]);
    const count=await db.query(`SELECT COUNT(*)::integer AS total FROM notificacoes_admin n WHERE empresa_id=$1
        AND NOT EXISTS (SELECT 1 FROM notificacoes_admin_leituras l WHERE l.notificacao_id=n.id AND l.usuario_id=$2)`,[req.user.empresaId,req.user.id]);
    res.json({success:true,data:result.rows,naoLidas:count.rows[0].total,page:page(req)});
}));
router.patch("/notificacoes/:id/lida",wrap(async(req,res)=>{
    await db.query(`INSERT INTO notificacoes_admin_leituras(notificacao_id,usuario_id)
        SELECT id,$2 FROM notificacoes_admin WHERE id=$1 AND empresa_id=$3 ON CONFLICT DO NOTHING`,
        [req.params.id,req.user.id,req.user.empresaId]);
    res.json({success:true});
}));
for(const [path,table,statuses] of [
    ["lgpd","lgpd_solicitacoes",["ABERTA","EM_ANALISE","ATENDIDA","NEGADA"]],
    ["atendimento","solicitacoes_consumidor",["RECEBIDA","EM_ANALISE","ATENDIDA","NEGADA"]]
]) {
    router.get("/"+path,role("ADMIN","GERENTE"),wrap(async(req,res)=>{
        const result=await db.query(`SELECT *,COUNT(*) OVER() AS total FROM ${table}
            WHERE empresa_id=$1 AND (protocolo ILIKE $2 OR tipo ILIKE $2)
            AND ($3::text IS NULL OR status=$3) ORDER BY solicitada_em DESC,id LIMIT 25 OFFSET $4`,
            [req.user.empresaId,"%"+String(req.query.q||"").slice(0,100)+"%",req.query.status||null,(page(req)-1)*25]);
        res.json({success:true,data:result.rows,page:page(req)});
    }));
    router.patch("/"+path+"/:id",role("ADMIN","GERENTE"),wrap(async(req,res)=>{
        const {status,resposta}=req.body;
        if(!statuses.includes(status) || typeof resposta!=="string" || resposta.trim().length<5 || resposta.length>2000)
            return res.status(400).json({success:false,message:"Informe um status válido e uma resposta entre 5 e 2000 caracteres."});
        const saved=await db.transaction(async client=>{
            const found=await client.query(`SELECT * FROM ${table} WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,[req.params.id,req.user.empresaId]);
            if(!found.rows[0]) throw Object.assign(new Error("Solicitação não encontrada."),{status:404});
            if(["ATENDIDA","NEGADA"].includes(found.rows[0].status)) throw Object.assign(new Error("Solicitação já encerrada."),{status:409});
            const result=await client.query(`UPDATE ${table} SET status=$1,resposta=$2,atendida_por=$3,
                atendida_em=CASE WHEN $1 IN ('ATENDIDA','NEGADA') THEN NOW() ELSE NULL END,updated_at=NOW()
                WHERE id=$4 AND empresa_id=$5 RETURNING *`,[status,resposta.trim(),req.user.id,req.params.id,req.user.empresaId]);
            const item=result.rows[0];
            await audit.record(client,req,"RESPONDER",table,item.id,found.rows[0],item);
            if(item.cliente_id) await client.query("INSERT INTO notificacoes(cliente_id,titulo,mensagem,tipo) VALUES($1,$2,$3,'SISTEMA')",
                [item.cliente_id,"Resposta ao protocolo "+item.protocolo,resposta.trim()]);
            return item;
        });
        if(saved.email_referencia) await sendOptionalEmail({to:saved.email_referencia,subject:"PetFlow: protocolo "+saved.protocolo,text:resposta.trim()});
        res.json({success:true,data:saved});
    }));
}
module.exports=router;
