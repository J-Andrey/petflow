"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {assertTransition,normalizeItems,reservationMinutes}=require("../services/orderRules");
const {validCpf,validRegistration}=require("../services/customerValidation");
const {safeData}=require("../services/auditService");
const {imageFormat,maxFileSize}=require("../services/imageValidation");
const {protectSelf,validate}=require("../services/adminUserService");
const id="11111111-1111-4111-8111-111111111111";
test("aprovação manual de pagamento é proibida",()=>{assert.throws(()=>assertTransition("AGUARDANDO_PAGAMENTO","PAGAMENTO_APROVADO"),{status:403});});
test("entrega exige separação e saída; entregue não pode cancelar",()=>{
    assert.doesNotThrow(()=>assertTransition("PAGAMENTO_APROVADO","EM_SEPARACAO"));
    assert.throws(()=>assertTransition("AGUARDANDO_PAGAMENTO","ENTREGUE"));
    assert.throws(()=>assertTransition("ENTREGUE","CANCELADA"));
    assert.throws(()=>assertTransition("FINALIZADA","AGUARDANDO_PAGAMENTO"));
});
test("itens repetidos são somados, preço do navegador é ignorado",()=>{
    assert.deepEqual(normalizeItems([{produto_id:id,quantidade:2,preco:0.01},{produtoId:id,quantidade:3}]),[{produto_id:id,quantidade:5}]);
});
test("quantidades fracionadas, negativas, infinitas e UUID inválido são rejeitados",()=>{
    for(const quantidade of [-1,0,1.5,Infinity,1000])assert.throws(()=>normalizeItems([{produto_id:id,quantidade}]));
    assert.throws(()=>normalizeItems([{produto_id:"bad",quantidade:1}]));
});
test("prazo de reserva precisa ser inteiro e limitado",()=>{assert.equal(reservationMinutes(30),30);for(const value of [0,-1,1.5,Infinity,1441])assert.throws(()=>reservationMinutes(value));});
test("CPF valida dígitos verificadores",()=>{assert.equal(validCpf("529.982.247-25"),true);assert.equal(validCpf("52998224724"),false);assert.equal(validCpf("11111111111"),false);});
test("cadastro exige os dois aceites",()=>{
    const data={nome:"Cliente Teste",cpf:"52998224725",email:"teste@example.test",telefone:"11999999999",cep:"01310100",endereco:"Avenida Teste",numero:"1",bairro:"Centro",cidade:"São Paulo",estado:"SP",senha:"12345678",aceite_privacidade:true,aceite_termos:true};
    assert.equal(validRegistration(data),true);assert.equal(validRegistration({...data,aceite_termos:false}),false);
    assert.equal(validRegistration({...data,estado:"ZZ"}),false);
});
test("auditoria remove senhas, tokens e objetos externos",()=>{
    assert.deepEqual(safeData({nome:"Ana",senha:"secret",senha_hash:"secret",token:"secret",apiKey:"secret",cartao:"secret",resposta:{token:"secret"}}),{nome:"Ana",resposta:"[omitido]"});
});
test("administrador não se desativa ou se rebaixa",()=>{
    assert.throws(()=>protectSelf(id,id,{perfil:"ADMIN"},{perfil:"ADMIN",ativo:false}),{status:409});
    assert.throws(()=>protectSelf(id,id,{perfil:"ADMIN"},{perfil:"GERENTE",ativo:true}),{status:409});
    assert.throws(()=>validate({nome:"Ana",email:"ana@example.test",perfil:"ROOT",ativo:true,senha:"12345678"},true));
});
test("upload compara assinatura binária com MIME",()=>{
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(8)]);
    assert.equal(imageFormat(png,"image/png"),"png");assert.equal(imageFormat(png,"image/jpeg"),null);
    assert.equal(imageFormat(Buffer.from("<svg onload=x>"),"image/png"),null);
    assert.equal(maxFileSize("invalid"),5242880);
});
