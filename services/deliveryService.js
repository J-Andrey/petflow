"use strict";
const jwt=require("jsonwebtoken");
const {digits}=require("./customerValidation");
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function normalizeAddress(input={}) {
    const out={};
    for(const key of ["cep","endereco","numero","complemento","bairro","cidade","estado"]) {
        if(input[key]!=null&&typeof input[key]!=="string")fail("Endereço inválido.");
        out[key]=String(input[key]||"").trim().replace(/\s+/g," ");
        if(out[key].length>160)fail("Endereço inválido.");
    }
    out.cep=digits(out.cep);out.estado=out.estado.toUpperCase();
    if(!/^\d{8}$/.test(out.cep)||!out.endereco||!out.numero||!out.bairro||!out.cidade||!/^[A-Z]{2}$/.test(out.estado))fail("Complete o endereço de entrega.");
    return out;
}
function config(env=process.env) {
    if(!env.DELIVERY_ORIGIN_ADDRESS||!env.GOOGLE_MAPS_API_KEY)fail("Entrega ainda não configurada pela loja.",503);
    const free=Number(env.DELIVERY_FREE_DISTANCE_KM),rate=Number(env.DELIVERY_PRICE_PER_KM),max=Number(env.DELIVERY_MAX_DISTANCE_KM);
    if(!Number.isFinite(free)||free<0||!Number.isFinite(rate)||rate<0||!Number.isFinite(max)||max<=0||free>max)
        fail("A loja precisa configurar as regras de frete.",503);
    return {free,rate,max,fraction:env.DELIVERY_CHARGE_FRACTION!=="false",origin:env.DELIVERY_ORIGIN_ADDRESS,key:env.GOOGLE_MAPS_API_KEY};
}
function calculateCents(distance,settings) {
    if(!Number.isSafeInteger(distance)||distance<0)fail("Distância indisponível.",502);
    if(distance>settings.max*1000)fail("Endereço fora da área de entrega.",422);
    const chargeable=Math.max(0,distance/1000-settings.free);
    const km=settings.fraction?chargeable:Math.ceil(chargeable);
    return Math.round(km*Math.round(settings.rate*100));
}
function createDeliveryService({secret,env=process.env,fetcher=fetch}) {
    const inflight=new Map(),cepCache=new Map();
    async function quote(empresaId,input) {
        const address=normalizeAddress(input),settings=config(env),key=JSON.stringify([empresaId,address]);
        if(inflight.has(key))return inflight.get(key);
        const operation=(async()=>{
            let response;
            try {response=await fetcher("https://routes.googleapis.com/directions/v2:computeRoutes",{
                method:"POST",signal:AbortSignal.timeout(10000),
                headers:{"Content-Type":"application/json","X-Goog-Api-Key":settings.key,"X-Goog-FieldMask":"routes.distanceMeters,routes.duration"},
                body:JSON.stringify({origin:{address:settings.origin},destination:{address:[address.endereco,address.numero,address.bairro,address.cidade,address.estado,address.cep,"Brasil"].join(", ")},travelMode:"DRIVE",languageCode:"pt-BR",units:"METRIC"})
            });}catch{fail("Não foi possível cotar o frete. Tente novamente.",503);}
            if(!response.ok)fail("Não foi possível cotar o frete. Tente novamente.",503);
            const payload=await response.json();const distance=payload.routes?.[0]?.distanceMeters;
            const cents=calculateCents(distance,settings);
            const token=jwt.sign({empresaId,address,distance,cents},secret,{algorithm:"HS256",expiresIn:"15m",audience:"petflow:frete",issuer:"petflow"});
            return {token,endereco:address,distancia_m:distance,frete_centavos:cents,expira_em:new Date(Date.now()+900000).toISOString()};
        })();
        inflight.set(key,operation);
        try{return await operation;}finally{inflight.delete(key);}
    }
    function verify(token,empresaId,input) {
        let payload;
        try{payload=jwt.verify(token,secret,{algorithms:["HS256"],audience:"petflow:frete",issuer:"petflow"});}
        catch{fail("Cotação inválida ou expirada. Calcule o frete novamente.");}
        if(payload.empresaId!==empresaId||JSON.stringify(payload.address)!==JSON.stringify(normalizeAddress(input))||
            !Number.isSafeInteger(payload.cents)||payload.cents<0)fail("Endereço alterado. Calcule o frete novamente.");
        return payload;
    }
    async function cep(value) {
        const cep=digits(value);if(!/^\d{8}$/.test(cep))fail("CEP inválido.");
        const cached=cepCache.get(cep);if(cached&&cached.expires>Date.now())return cached.value;
        let result;
        for(const url of ["https://viacep.com.br/ws/"+cep+"/json/","https://brasilapi.com.br/api/cep/v1/"+cep]) {
            try {
                const response=await fetcher(url,{signal:AbortSignal.timeout(5000)});
                if(!response.ok)continue;
                const data=await response.json();if(data.erro)continue;
                result={cep,endereco:data.logradouro||data.street||"",bairro:data.bairro||data.neighborhood||"",cidade:data.localidade||data.city||"",estado:data.uf||data.state||""};
                if(result.cidade&&result.estado)break;
            }catch{}
        }
        if(!result?.cidade)fail("CEP não encontrado. Preencha o endereço manualmente.",422);
        if(cepCache.size>=500)cepCache.delete(cepCache.keys().next().value);
        cepCache.set(cep,{expires:Date.now()+300000,value:result});return result;
    }
    return {quote,verify,cep};
}
module.exports={normalizeAddress,calculateCents,createDeliveryService};
