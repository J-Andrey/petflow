"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createDeliveryService,calculateCents}=require("../services/deliveryService");
const {discountCents,validate}=require("../services/couponService");
const address={cep:"01310-100",endereco:"Avenida Teste",numero:"10",complemento:"",bairro:"Centro",cidade:"São Paulo",estado:"SP"};
const env={DELIVERY_ORIGIN_ADDRESS:"Origem de teste",GOOGLE_MAPS_API_KEY:"not-real",DELIVERY_FREE_DISTANCE_KM:"1",DELIVERY_PRICE_PER_KM:"2",DELIVERY_MAX_DISTANCE_KM:"20"};
test("frete respeita distância gratuita, fração e área máxima",()=>{
    const settings={free:1,rate:2,max:20,fraction:true};
    assert.equal(calculateCents(1000,settings),0);assert.equal(calculateCents(1500,settings),100);
    assert.equal(calculateCents(1500,{...settings,fraction:false}),200);
    assert.throws(()=>calculateCents(20001,settings),{status:422});
    assert.throws(()=>calculateCents(undefined,settings));
});
test("cotação assinada vincula empresa e endereço; adulteração é rejeitada",async()=>{
    const service=createDeliveryService({secret:"test",env,fetcher:async()=>({ok:true,async json(){return {routes:[{distanceMeters:3500}]};}})});
    const quote=await service.quote("company",address);
    assert.equal(quote.frete_centavos,500);assert.equal(service.verify(quote.token,"company",address).cents,500);
    assert.throws(()=>service.verify(quote.token,"other",address));
    assert.throws(()=>service.verify(quote.token,"company",{...address,numero:"20"}));
    assert.throws(()=>service.verify(quote.token+"tampered","company",address));
});
test("falha do Google nunca produz frete gratuito",async()=>{
    const service=createDeliveryService({secret:"test",env,fetcher:async()=>{throw Error("network");}});
    await assert.rejects(service.quote("company",address),{status:503});
});
test("cotações concorrentes idênticas compartilham a requisição externa",async()=>{
    let calls=0;
    const service=createDeliveryService({secret:"test",env,fetcher:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return {ok:true,async json(){return {routes:[{distanceMeters:3000}]};}};}});
    await Promise.all([service.quote("company",address),service.quote("company",address)]);
    assert.equal(calls,1);
});
test("CEP usa BrasilAPI quando ViaCEP falha",async()=>{
    const urls=[];
    const service=createDeliveryService({secret:"test",env,fetcher:async url=>{
        urls.push(url);return url.includes("viacep")?{ok:false}:{ok:true,async json(){return {street:"Rua",neighborhood:"Centro",city:"Cidade",state:"SP"};}};
    }});
    assert.equal((await service.cep("01310100")).endereco,"Rua");assert.equal(urls.length,2);
    await service.cep("01310100");assert.equal(urls.length,2);
});
test("cupom calcula centavos, respeita teto e não supera produtos",()=>{
    assert.equal(discountCents({tipo:"PERCENTUAL",valor:10,minimo_compra:0,desconto_maximo:null},999),100);
    assert.equal(discountCents({tipo:"FIXO",valor:50,minimo_compra:0,desconto_maximo:null},999),999);
    assert.equal(discountCents({tipo:"PERCENTUAL",valor:50,minimo_compra:0,desconto_maximo:2},1000),200);
    assert.throws(()=>discountCents({tipo:"FIXO",valor:2,minimo_compra:20},1000));
});
test("validação transacional bloqueia cupom e verifica limite de usos",async()=>{
    const queries=[];const client={async query(sql){queries.push(sql);return sql.includes("FROM cupons")?{rows:[{tipo:"FIXO",valor:1,minimo_compra:0,limite_usos:1}]}:{rows:[{total:1,cliente:0}]};}};
    await assert.rejects(validate(client,{empresaId:"company",clienteId:"customer",code:"PROMO",subtotal:1000,lock:true}));
    assert.match(queries[0],/FOR UPDATE/);
});
