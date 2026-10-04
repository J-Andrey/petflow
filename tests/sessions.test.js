"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),jwt=require("jsonwebtoken");
const {signSession,createSessionMiddleware,validPassword,hashToken}=require("../services/sessionService");
const {response,load}=require("./helpers");
const secret="test-secret-not-for-production-0123456789";
const account={id:"11111111-1111-4111-8111-111111111111",empresa_id:"22222222-2222-4222-8222-222222222222",perfil:"ADMIN",sessao_versao:2};
async function authenticate(token,rows=[account],type="admin") {
    const queries=[],db={async query(sql,params){queries.push({sql,params});return {rows};}};
    const req={headers:{authorization:"Bearer "+token}},res=response();let next=false;
    await createSessionMiddleware({db,secret,type})(req,res,error=>{next=error||true;});
    return {req,res,next,queries};
}
test("JWT inclui expiração, empresa, tipo, perfil e versão",()=>{
    const value=jwt.verify(signSession(account,"admin",secret),secret);
    assert.equal(value.type,"admin");assert.equal(value.perfil,"ADMIN");assert.equal(value.sessao_versao,2);
    assert.ok(value.exp>value.iat);assert.equal(value.empresaId,account.empresa_id);
});
test("sessão válida consulta conta com empresa e usa perfil atual",async()=>{
    const result=await authenticate(signSession(account,"admin",secret));
    assert.equal(result.next,true);assert.equal(result.req.user.cargo,"ADMIN");
    assert.deepEqual(result.queries[0].params,[account.id,account.empresa_id]);
    assert.match(result.queries[0].sql,/ativo = TRUE/);
});
test("token de cliente nunca entra na administração",async()=>{
    const result=await authenticate(signSession(account,"customer",secret));
    assert.equal(result.res.statusCode,401);assert.equal(result.queries.length,0);
});
test("token administrativo nunca entra na área do cliente",async()=>{
    const result=await authenticate(signSession(account,"admin",secret),[],"customer");
    assert.equal(result.res.statusCode,401);assert.equal(result.queries.length,0);
});
test("sessão revogada é rejeitada",async()=>{
    const result=await authenticate(signSession(account,"admin",secret),[{...account,sessao_versao:3}]);
    assert.equal(result.res.statusCode,401);assert.equal(result.next,false);
});
test("conta removida ou inativa é rejeitada",async()=>{
    assert.equal((await authenticate(signSession(account,"admin",secret),[])).res.statusCode,401);
});
test("perfil alterado invalida token mesmo com versão igual",async()=>{
    assert.equal((await authenticate(signSession(account,"admin",secret),[{...account,perfil:"GERENTE"}])).res.statusCode,401);
});
test("token expirado e legado sem audience são rejeitados",async()=>{
    assert.equal((await authenticate(signSession(account,"admin",secret,"-1s"))).res.statusCode,401);
    assert.equal((await authenticate(jwt.sign(account,secret))).res.statusCode,401);
});
test("senha usa limite de bytes UTF-8 do bcrypt",()=>{
    assert.equal(validPassword("1234567"),false);assert.equal(validPassword("12345678"),true);
    assert.equal(validPassword("á".repeat(36)),true);assert.equal(validPassword("á".repeat(37)),false);
    assert.equal(validPassword({}),false);
});
test("token armazenado é SHA-256",()=>{assert.equal(hashToken("abc"),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");});
test("consumo de recuperação é UPDATE atômico com expiração e revogação",async()=>{
    const calls=[];
    const model=load("models/authModel.js",{"../database/connection":{async query(sql,params){calls.push({sql,params});return {rowCount:1};}}});
    assert.equal(await model.consumePasswordResetToken("secret","bcrypt-hash"),true);
    assert.equal(calls.length,1);assert.match(calls[0].sql,/token_expiracao>NOW\(\)/);assert.match(calls[0].sql,/sessao_versao=sessao_versao\+1/);
    assert.equal(calls[0].params[1],hashToken("secret"));
});
