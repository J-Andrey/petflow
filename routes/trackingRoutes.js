"use strict";
const router=require("express").Router(),db=require("../database/connection"),tracking=require("../services/trackingService");
const {rateLimit}=require("express-rate-limit");
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const token=req=>String(req.get("authorization")||"").replace(/^Delivery /,"");
router.use(rateLimit({windowMs:60000,limit:40,standardHeaders:"draft-8",legacyHeaders:false}));
router.use((req,res,next)=>{res.set("Cache-Control","no-store");next();});
router.get("/config",(req,res)=>res.json({success:true,key:process.env.GOOGLE_MAPS_BROWSER_API_KEY||null}));
router.get("/entregador",wrap(async(req,res)=>{
    const current=await tracking.driver(db,token(req));
    let route=null,routeError=null;
    try{route=await tracking.route(db,current);}catch(error){routeError=error.message;}
    res.json({success:true,data:{...tracking.publicData(current),rota:route,erro_rota:routeError}});
}));
router.post("/entregador/localizacao",wrap(async(req,res)=>res.json({success:true,data:await tracking.position(db,token(req),req.body)})));
router.delete("/entregador",wrap(async(req,res)=>{
    const current=await tracking.driver(db,token(req));
    await db.query("DELETE FROM entrega_rastreamento WHERE venda_id=$1 AND token_hash=$2",[current.venda_id,tracking.hash(token(req))]);
    res.json({success:true});
}));
for(const [path,middleware] of [["cliente",require("../middlewares/customerAuthMiddleware")],["admin",require("../middlewares/authMiddleware")]]) {
    router.get("/"+path+"/:id",middleware,wrap(async(req,res)=>{
        if(!require("../services/sessionService").UUID.test(req.params.id))return res.status(400).json({success:false,message:"Pedido inválido."});
        const principal=req.customer||req.user;
        const {rows}=await db.query(`SELECT r.*,v.endereco_entrega FROM entrega_rastreamento r JOIN vendas v ON v.id=r.venda_id
            WHERE v.id=$1 AND v.empresa_id=$2 AND v.status='SAIU_PARA_ENTREGA' AND r.expira_em>NOW()
            ${path==="cliente"?"AND v.cliente_id=$3":""}`,path==="cliente"?[req.params.id,principal.empresaId,principal.id]:[req.params.id,principal.empresaId]);
        if(!rows[0])return res.status(404).json({success:false,message:"Entrega não disponível para rastreamento."});
        let route=null,routeError=null;try{route=await tracking.route(db,rows[0]);}catch(error){routeError=error.message;}
        res.json({success:true,data:{...tracking.publicData(rows[0]),rota:route,erro_rota:routeError}});
    }));
}
router.post("/admin/:id/link",require("../middlewares/authMiddleware"),require("../middlewares/roleMiddleware")("ADMIN","GERENTE"),wrap(async(req,res)=>{
    if(!require("../services/sessionService").UUID.test(req.params.id))return res.status(400).json({success:false,message:"Pedido inválido."});
    res.status(201).json({success:true,data:await tracking.createLink(db,req,req.params.id)});
}));
module.exports=router;
