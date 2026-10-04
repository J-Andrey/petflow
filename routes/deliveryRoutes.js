"use strict";
const router=require("express").Router(),db=require("../database/connection");
const {rateLimit}=require("express-rate-limit");
const service=require("../services/deliveryService").createDeliveryService({secret:require("../config/env").JWT_SECRET});
router.use(rateLimit({windowMs:60000,limit:20,standardHeaders:"draft-8",legacyHeaders:false}));
router.get("/cep/:cep",async(req,res,next)=>{try{res.json({success:true,data:await service.cep(req.params.cep)});}catch(error){next(error);}});
router.post("/frete",async(req,res,next)=>{try{
    const {rows}=await db.query("SELECT get_petflow_empresa_id() AS id");
    res.json({success:true,data:await service.quote(rows[0].id,req.body.endereco)});
}catch(error){next(error);}});
router.post("/cupons/validar",async(req,res,next)=>{
    const run=async()=>{
        const {rows}=await db.query("SELECT get_petflow_empresa_id() AS id");
        if(req.customer&&req.customer.empresaId!==rows[0].id)throw Object.assign(new Error("Empresa inválida."),{status:403});
        res.json({success:true,data:await require("../services/couponService").preview(db,rows[0].id,req.customer?.id,req.body)});
    };
    try{
        if(req.headers.authorization)return require("../middlewares/customerAuthMiddleware")(req,res,error=>error?next(error):run().catch(next));
        await run();
    }catch(error){next(error);}
});
module.exports=router;
