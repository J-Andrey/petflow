"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const {load}=require("./helpers");
const validation=require("../services/productValidation");
const category="11111111-1111-4111-8111-111111111111";
const product={categoriaId:category,nome:"Produto real",sku:"SKU-TEST",preco:"20.50",custo:"10.25",estoque_minimo:"3",status:"false"};
test("produto normaliza valores, status e campos completos sem aceitar dinheiro impreciso",()=>{
    const result=validation.normalize({...product,marca:"Marca",unidade_medida:"KG",codigoBarras:"123"});
    assert.equal(result.preco,20.5);assert.equal(result.custo,10.25);assert.equal(result.status,false);
    assert.equal(result.estoque_minimo,3);assert.equal(result.marca,"Marca");assert.equal(result.unidade_medida,"KG");
    for(const value of [true,"1.001",Infinity,"-1","",null]) assert.throws(()=>validation.normalize({...product,preco:value}));
    assert.throws(()=>validation.normalize({...product,preco:"1.00"}));
    assert.throws(()=>validation.normalize({...product,estoque_minimo:1.5}));
    assert.throws(()=>validation.normalize({...product,fornecedor_id:"invalid"}));
    assert.throws(()=>validation.normalize({...product,status:"ativo"}));
});
test("API administrativa envia arquivo e JSON com cabeçalhos adequados na origem atual",async()=>{
    const calls=[];
    const context=vm.createContext({FormData,console:{error(){}},getToken:()=>"synthetic-token",window:{location:{hostname:"localhost"}},
        fetch:async(url,config)=>{calls.push({url,config});return {ok:true,status:201,json:async()=>({success:true})};}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../public/js/services/api.js"),"utf8"),context);
    const form=new FormData();form.append("nome","Produto");form.append("foto",new Blob(["synthetic-image"]),"produto.png");
    await context.apiPost("/produtos",form);await context.apiPut("/produtos/id",form);await context.apiPost("/usuarios",{nome:"Teste"});
    assert.equal(calls[0].url,"/api/produtos");assert.equal(calls[0].config.body,form);assert.equal(calls[1].config.body,form);
    assert.equal(calls[0].config.headers["Content-Type"],undefined);assert.equal(calls[0].config.headers.Authorization,"Bearer synthetic-token");
    assert.equal(calls[2].config.headers["Content-Type"],"application/json");assert.equal(JSON.parse(calls[2].config.body).nome,"Teste");
});
test("lançamentos conciliados não permitem edição nem pagamento administrativo",()=>{
    const financial=load("services/financialAdminService.js",{"../models/financeiroModel":{}});
    for(const origem of ["ESTORNO","CHARGEBACK","REVERSAO_CHARGEBACK"])
        assert.throws(()=>financial.prepare({valor_pago:1},{origem}),{status:409});
});
