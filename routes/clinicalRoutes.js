"use strict";
const router=require("express").Router(),db=require("../database/connection"),clinical=require("../services/clinicalService");
router.use(require("../middlewares/authMiddleware"),require("../middlewares/roleMiddleware")("ADMIN","GERENTE"));
router.use((req,res,next)=>{res.set("Cache-Control","no-store");next();});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
for(const kind of Object.keys(clinical.definitions)){
    router.get("/"+kind,wrap(async(req,res)=>{
        const page=Math.max(1,Math.min(10000,parseInt(req.query.page,10)||1));
        const {rows}=await db.query("SELECT *,COUNT(*) OVER() AS total FROM "+kind+" WHERE empresa_id=$1 ORDER BY updated_at DESC,id LIMIT 25 OFFSET $2",[req.user.empresaId,(page-1)*25]);
        res.json({success:true,data:rows,page});
    }));
    router.post("/"+kind,wrap(async(req,res)=>res.status(201).json({success:true,data:await clinical.save(db,req,kind)})));
    router.put("/"+kind+"/:id",wrap(async(req,res)=>{
        if(!require("../services/sessionService").UUID.test(req.params.id))return res.status(400).json({success:false,message:"Identificador inválido."});
        res.json({success:true,data:await clinical.save(db,req,kind,req.params.id)});
    }));
}
module.exports=router;
