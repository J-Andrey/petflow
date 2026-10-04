"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {load}=require("./helpers");
const express=require("express");
const {signSession}=require("../services/sessionService");
const secret="test-secret-not-for-production-0123456789";
function isolatedModule(filename,exports) {require.cache[require.resolve(filename)]={id:require.resolve(filename),filename:require.resolve(filename),loaded:true,exports};}
const queries=[];
const db={async query(sql,params){queries.push({sql,params});if(sql.includes("FROM usuarios"))return {rows:[]};return {rows:[],rowCount:0};}};
isolatedModule("../database/connection",db);
isolatedModule("../config/env",{JWT_SECRET:secret,JWT_EXPIRES_IN:"7d",APP_URL:"http://localhost",CLOUDINARY_CLOUD_NAME:"test",CLOUDINARY_API_KEY:"test",CLOUDINARY_API_SECRET:"test"});
isolatedModule("../services/emailService",{});
test("API de usuários rejeita visitante e token de cliente antes de consultar dados",async t=>{
    const app=express();app.use(express.json());app.use("/api",require("../routes/professionalRoutes"));
    const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const url="http://127.0.0.1:"+server.address().port+"/api/usuarios";
    const anonymous=await fetch(url);assert.equal(anonymous.status,401);
    const token=signSession({id:"11111111-1111-4111-8111-111111111111",empresa_id:"22222222-2222-4222-8222-222222222222",sessao_versao:1},"customer",secret);
    const customer=await fetch(url,{headers:{Authorization:"Bearer "+token}});
    assert.equal(customer.status,401);assert.equal(queries.length,0);
});
test("catálogo público inclui escopo de empresa e reservas na disponibilidade",async()=>{
    const catalog=load("controllers/publicCatalogController.js",{"../database/connection":db});
    const response={status(){return this;},json(data){return data;}};
    await catalog.produtos({},response,error=>{throw error;});
    const sql=queries.at(-1).sql;assert.match(sql,/p\.empresa_id=get_petflow_empresa_id\(\)/);assert.match(sql,/reservas_estoque/);
});
test("erros internos não expõem SQL ou credenciais",()=>{
    const errorHandler=require("../middlewares/errorMiddleware");
    const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    errorHandler(new Error("postgres://password@host secret SQL"),{},res,()=>{});
    assert.equal(res.code,500);assert.doesNotMatch(res.body.message,/password|SQL/);
});
