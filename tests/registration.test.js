"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {load,response}=require("./helpers");
const body={nome:"Cliente Teste",cpf:"52998224725",email:"teste@example.test",telefone:"11999999999",cep:"01310100",endereco:"Avenida Teste",numero:"1",bairro:"Centro",cidade:"São Paulo",estado:"SP",senha:"12345678",aceite_privacidade:true,aceite_termos:true};
test("falha no envio crítico reverte cadastro e nunca retorna sucesso",async()=>{
    const calls=[];let rolledBack=false;
    const client={async query(sql,params){calls.push({sql,params});return {rows:[{id:"test"}],rowCount:sql.startsWith("SELECT id FROM clientes")?0:1};}};
    const controller=load("controllers/publicCustomerController.js",{
        bcrypt:{async hash(){return "hash";}},
        "../database/connection":{async transaction(fn){try{return await fn(client);}catch(error){rolledBack=true;throw error;}}},
        "../config/env":{JWT_SECRET:"test-secret",APP_URL:"https://example.test"},
        "../services/emailService":{emailVerificationTemplate(){return {subject:"Verifique",text:"Teste"};},async sendEmail(){throw new Error("Network");}}
    });
    const res=response();let error;
    await controller.register({body,ip:"127.0.0.1",get(){return "test";}},res,value=>{error=value;});
    assert.equal(rolledBack,true);assert.ok(error);assert.equal(res.body,undefined);
    const account=calls.find(c=>c.sql.startsWith("INSERT INTO usuarios_clientes"));
    assert.equal(account.params[3].length,64);assert.equal(calls.filter(c=>c.sql.startsWith("INSERT INTO lgpd_consentimentos")).length,2);
});
test("exclusão gera protocolo sem apagar pets, agenda ou pedidos",async()=>{
    const queries=[];const client={async query(sql,params){queries.push({sql,params});return {rows:[]};}};
    const controller=load("controllers/publicCustomerController.js",{
        "../database/connection":{async transaction(fn){return fn(client);}},
        "../config/env":{JWT_SECRET:"test-secret",APP_URL:"https://example.test"},"../services/emailService":{}
    });
    const res=response();await controller.remove({customer:{id:"id",empresaId:"company",email:"test@example.test"}},res,error=>{throw error;});
    assert.equal(res.statusCode,202);assert.match(res.body.protocolo,/^LGPD-/);
    assert.ok(queries.some(q=>q.sql.includes("lgpd_solicitacoes")));
    assert.ok(queries.some(q=>q.sql.includes("sessao_versao")));
    assert.ok(queries.every(q=>!/^DELETE FROM (pets|agendamentos|clientes|vendas)/.test(q.sql)));
});
