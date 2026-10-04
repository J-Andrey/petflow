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
module.exports=router;
