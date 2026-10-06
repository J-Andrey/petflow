"use strict";
const router=require("express").Router(),db=require("../database/connection"),service=require("../services/cancellationService");
const gateway=require("../services/pagseguroService");
for(const [kind,auth] of [["cliente",require("../middlewares/customerAuthMiddleware")],["admin",require("../middlewares/authMiddleware")]]){
    router.post("/"+kind+"/:id",auth,async(req,res,next)=>{
        try{
            if(!require("../services/sessionService").UUID.test(req.params.id))return res.status(400).json({success:false,message:"Pedido inválido."});
            const result=await service.requestCancellation(db,req,req.params.id,gateway);
            res.status(result.status==="CANCELADA"?200:202).json({success:true,data:result});
        }catch(error){next(error);}
    });
}
module.exports=router;
