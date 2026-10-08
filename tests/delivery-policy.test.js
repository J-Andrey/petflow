"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createDeliveryService,calculateCents,deliveryErrors}=require("../services/deliveryService");
const {load,response}=require("./helpers");
const address={cep:"09015080",endereco:"Praça IV Centenário",numero:"1",bairro:"Centro",cidade:"Santo André",estado:"SP"};
const env={DELIVERY_ORIGIN_ADDRESS:"Origem",GOOGLE_MAPS_API_KEY:"test",DELIVERY_FREE_DISTANCE_KM:"1",DELIVERY_PRICE_PER_KM:"3",DELIVERY_MAX_DISTANCE_KM:"20",DELIVERY_CHARGE_FRACTION:"true"};
test("política definida cobra 3 reais por km excedente a 1km até 20km",()=>{
    const settings={free:1,rate:3,max:20,fraction:true};
    for(const [meters,cents] of [[0,0],[1000,0],[1500,150],[3120,636],[20000,5700]])assert.equal(calculateCents(meters,settings),cents);
    assert.throws(()=>calculateCents(20001,settings),{status:422});
});
test("configuração ausente ou vazia nunca se converte em frete gratuito",async()=>{
    for(const key of Object.keys(env).filter(key=>key!=="DELIVERY_CHARGE_FRACTION"))for(const value of [undefined,"","   "]){
        const service=createDeliveryService({secret:"test",env:{...env,[key]:value},fetcher:()=>{throw Error("Não deveria consultar");}});
        await assert.rejects(service.quote("company",address),{status:503,code:"DELIVERY_NOT_CONFIGURED"});
    }
});
test("provedor sem rota ou resposta inválida retorna orientação segura",async()=>{
    for(const [provider,code,status] of [[{ok:false},"DELIVERY_PROVIDER_UNAVAILABLE",503],[{ok:true,json:async()=>{throw Error("secret");}},"DELIVERY_PROVIDER_UNAVAILABLE",503],[{ok:true,json:async()=>({routes:[]})},"DELIVERY_ROUTE_UNAVAILABLE",422]]){
        const service=createDeliveryService({secret:"test",env,fetcher:async()=>provider});
        await assert.rejects(service.quote("company",address),{status,code,message:deliveryErrors[code]});
    }
});
test("rota de frete publica só mensagem conhecida e encaminha erro interno",async()=>{
    const handlers={},router={use(){},get(){},post(path,handler){handlers[path]=handler;}};
    let failure=Object.assign(Error("raw secret provider body"),{status:503,code:"DELIVERY_NOT_CONFIGURED"});
    load("routes/deliveryRoutes.js",{
        express:{Router:()=>router},"express-rate-limit":{rateLimit:()=>()=>{}},"../database/connection":{query:async()=>({rows:[{id:"company"}]})},"../config/env":{JWT_SECRET:"test"},
        "../services/deliveryService":{deliveryErrors,createDeliveryService:()=>({quote:async()=>{throw failure;}})}
    });
    const res=response();await handlers["/frete"]({body:{endereco:address}},res,()=>assert.fail("Erro conhecido não encaminhado"));
    assert.equal(res.statusCode,503);assert.equal(res.body.code,"DELIVERY_NOT_CONFIGURED");assert.equal(res.body.message,deliveryErrors.DELIVERY_NOT_CONFIGURED);assert.doesNotMatch(JSON.stringify(res.body),/secret/);
    failure=Error("internal secret");let forwarded;await handlers["/frete"]({body:{}},response(),error=>{forwarded=error;});assert.equal(forwarded,failure);
});
