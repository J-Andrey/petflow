"use strict";
const router=require("express").Router(),db=require("../database/connection"),service=require("../services/cancellationService");
const gateway=require("../services/pagseguroService");
for(const [kind,auth] of [["cliente",require("../middlewares/customerAuthMiddleware")],["admin",require("../middlewares/authMiddleware")]]){
    router.post("/"+kind+"/:id",auth,async(req,res,next)=>{
        try{
            if(!require("../services/sessionService").UUID.test(req.params.id))return res.status(400).json({success:false,message:"Pedido inválido."});
            const result=await service.requestCancellation(db,req,req.params.id,gateway);
            if(result.notify){
                const principal=req.user||req.customer;
                const {rows}=await db.query("SELECT c.nome,c.email FROM vendas v JOIN clientes c ON c.id=v.cliente_id AND c.empresa_id=v.empresa_id WHERE v.id=$1 AND v.empresa_id=$2",[req.params.id,principal.empresaId]);
                if(rows[0]?.email){
                    const email=require("../services/emailService");
                    const template=email.orderCanceledTemplate({name:rows[0].nome,orderId:req.params.id});
                    await email.sendOptionalEmail({to:rows[0].email,...template,idempotencyKey:"cancel-"+req.params.id});
                }
            }
            res.status(result.status==="CANCELADA"?200:202).json({success:true,data:result});
        }catch(error){next(error);}
    });
}
module.exports=router;
