"use strict";
const router=require("express").Router();
const db=require("../database/connection");
const auth=require("../middlewares/authMiddleware");
const role=require("../middlewares/roleMiddleware");
const users=require("../services/adminUserService");
const audit=require("../services/auditService");
const {UUID}=require("../services/sessionService");
const {enqueueEmail}=require("../services/emailQueueService");
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const page=req=>Math.max(1,Math.min(10000,Number.parseInt(req.query.page,10)||1));
router.use(auth);
router.get("/checkouts",role("ADMIN","GERENTE"),wrap(async(req,res)=>{
    const result=await db.query(`SELECT t.venda_id AS id,t.status,t.criada_em,c.nome AS cliente,COUNT(*) OVER() AS total
        FROM checkout_tentativas t JOIN vendas v ON v.id=t.venda_id AND v.empresa_id=t.empresa_id
        JOIN clientes c ON c.id=v.cliente_id AND c.empresa_id=v.empresa_id
        WHERE t.empresa_id=$1 AND t.status<>'CONCLUIDA' AND (c.nome ILIKE $2 OR t.venda_id::text ILIKE $2)
        ORDER BY t.criada_em DESC LIMIT 25 OFFSET $3`,[req.user.empresaId,"%"+String(req.query.q||"").slice(0,100)+"%",(page(req)-1)*25]);
    res.json({success:true,data:result.rows,page:page(req)});
}));
router.post("/checkouts/:id/conciliar",role("ADMIN"),wrap(async(req,res)=>{
    const result=await require("../services/checkoutService").reconcile(db,req,req.params.id,req.body.checkout_id,require("../services/pagseguroService"));
    res.json({success:true,data:result});
}));
router.post("/lgpd/:id/processar",role("ADMIN"),wrap(async(req,res)=>{
    if(!UUID.test(req.params.id))return res.status(400).json({success:false,message:"Identificador inválido."});
    const result=await require("../services/privacyService").processRequest(db,req,req.params.id);
    res.json({success:true,data:{protocolo:result.protocolo,resposta:result.resposta}});
}));
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
router.get("/cupons",role("ADMIN","GERENTE"),wrap(async(req,res)=>{
    const result=await db.query("SELECT *,COUNT(*) OVER() AS total FROM cupons WHERE empresa_id=$1 AND (codigo ILIKE $2 OR descricao ILIKE $2) ORDER BY created_at DESC,id LIMIT 25 OFFSET $3",
        [req.user.empresaId,"%"+String(req.query.q||"").slice(0,100)+"%",(page(req)-1)*25]);
    res.json({success:true,data:result.rows,page:page(req)});
}));
async function saveCoupon(req,res) {
    const d=req.body,code=String(d.codigo||"").trim().toUpperCase();
    const money=value=>typeof value!=="boolean"&&value!==null&&value!==""&&Number.isFinite(Number(value))&&Number(value)>=0&&Number.isSafeInteger(Math.round(Number(value)*100))&&Number(value)<=9999999;
    const optionalLimit=value=>value==null||(Number.isInteger(Number(value))&&Number(value)>0);
    const starts=new Date(d.inicia_em),ends=d.expira_em?new Date(d.expira_em):null;
    if(!/^[A-Z0-9_-]{3,40}$/.test(code)||typeof d.descricao!=="string"||d.descricao.length>200||
        !["PERCENTUAL","FIXO"].includes(d.tipo)||!money(d.valor)||Number(d.valor)<=0||
        (d.tipo==="PERCENTUAL"&&Number(d.valor)>100)||!money(d.minimo_compra)||
        (d.desconto_maximo!=null&&(!money(d.desconto_maximo)||Number(d.desconto_maximo)<=0))||
        !optionalLimit(d.limite_usos)||!optionalLimit(d.limite_por_cliente)||Number.isNaN(starts.getTime())||
        (ends&&(Number.isNaN(ends.getTime())||ends<=starts))||typeof d.ativo!=="boolean"||typeof d.publico!=="boolean")
        return res.status(400).json({success:false,message:"Confira código, valores, limites e datas do cupom."});
    const saved=await db.transaction(async client=>{
        const before=req.params.id?(await client.query("SELECT * FROM cupons WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[req.params.id,req.user.empresaId])).rows[0]:null;
        if(req.params.id&&!before)throw Object.assign(new Error("Cupom não encontrado."),{status:404});
        const values=[code,d.descricao,d.tipo,d.valor,d.minimo_compra,d.desconto_maximo,starts,ends,d.limite_usos,d.limite_por_cliente,d.ativo,d.publico,req.user.empresaId];
        const result=req.params.id?await client.query(`UPDATE cupons SET codigo=$1,descricao=$2,tipo=$3,valor=$4,minimo_compra=$5,desconto_maximo=$6,
            inicia_em=$7,expira_em=$8,limite_usos=$9,limite_por_cliente=$10,ativo=$11,publico=$12,updated_at=NOW()
            WHERE empresa_id=$13 AND id=$14 RETURNING *`,[...values,req.params.id]):
            await client.query(`INSERT INTO cupons(codigo,descricao,tipo,valor,minimo_compra,desconto_maximo,inicia_em,expira_em,limite_usos,limite_por_cliente,ativo,publico,empresa_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,values);
        const resultRow=result.rows[0];await audit.record(client,req,before?"ATUALIZAR":"CRIAR","cupons",resultRow.id,before,resultRow);return resultRow;
    });
    res.status(req.params.id?200:201).json({success:true,data:saved});
}
router.post("/cupons",role("ADMIN"),wrap(saveCoupon));
router.put("/cupons/:id",role("ADMIN"),wrap(saveCoupon));
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
            if(path==="atendimento"&&["ATENDIDA","NEGADA"].includes(status)) {
                const active=await client.query("SELECT id FROM devolucoes WHERE solicitacao_id=$1 AND empresa_id=$2 AND status<>'CONCLUIDA'",[req.params.id,req.user.empresaId]);
                if(active.rows[0]) throw Object.assign(new Error("Devolução em andamento; confirme recebimento e reembolso antes de encerrar."),{status:409});
            }
            const result=await client.query(`UPDATE ${table} SET status=$1::text,resposta=$2,atendida_por=$3,
                atendida_em=CASE WHEN $1::text IN ('ATENDIDA','NEGADA') THEN NOW() ELSE NULL END,updated_at=NOW()
                WHERE id=$4 AND empresa_id=$5 RETURNING *`,[status,resposta.trim(),req.user.id,req.params.id,req.user.empresaId]);
            const item=result.rows[0];
            await audit.record(client,req,"RESPONDER",table,item.id,found.rows[0],item);
            if(item.cliente_id) await client.query("INSERT INTO notificacoes(cliente_id,titulo,mensagem,tipo) VALUES($1,$2,$3,'SISTEMA')",
                [item.cliente_id,"Resposta ao protocolo "+item.protocolo,resposta.trim()]);
            if(item.email_referencia) await enqueueEmail({to:item.email_referencia,subject:"PetFlow: protocolo "+item.protocolo,
                text:resposta.trim(),idempotencyKey:path+"-resposta-"+item.id+"-"+status},client);
            return item;
        });
        res.json({success:true,data:saved});
    }));
}
module.exports=router;
