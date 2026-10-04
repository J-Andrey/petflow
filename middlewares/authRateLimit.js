"use strict";
const {rateLimit}=require("express-rate-limit");
module.exports=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:"draft-8",legacyHeaders:false,
    message:{success:false,message:"Muitas tentativas. Aguarde 15 minutos antes de tentar novamente."}});
