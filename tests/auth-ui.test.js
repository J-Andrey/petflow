"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {validPassword}=require('../services/sessionService');
function loginUi(password){
 const calls=[],alerts=[],saved=[];
 const fields={email:{value:'admin@example.test',focus(){}},senha:{value:password,focus(){this.focused=true;}}};
 const context=vm.createContext({document:{getElementById:id=>fields[id],addEventListener(){},querySelectorAll:()=>[]},window:{location:{href:''}},alert:message=>alerts.push(message),AuthService:{async login(body){calls.push(body);return{data:{token:'session-token',user:{id:'admin'}}};}},saveToken:value=>saved.push(value),saveUser(){}});
 for(const file of ['public/js/utils/validation.js','public/js/pages/auth/login.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
 return{context,calls,alerts,saved,fields};
}
test('Login administrativo aceita senhas válidas do servidor sem exigir maiúscula ou número',async()=>{
 for(const password of ['abcdefgh','a'.repeat(72),'Á'.repeat(36)]){
  assert.equal(validPassword(password),true);
  const ui=loginUi(password);
  await vm.runInContext('handleLogin({preventDefault(){}})',ui.context);
  assert.equal(ui.calls.length,1);
  assert.equal(ui.calls[0].senha,password);
  assert.equal(ui.alerts.length,0);
  assert.equal(ui.context.window.location.href,'/admin/pages/dashboard/dashboard.html');
 }
});
test('Login preserva espaços de uma senha cadastrada e aceita senha legada',async()=>{
 for(const password of [' pass word ','        ','legada']){
  const ui=loginUi(password);
  await vm.runInContext('handleLogin({preventDefault(){}})',ui.context);
  assert.equal(ui.calls.length,1);
  assert.equal(ui.calls[0].senha,password);
 }
});
test('Login vazio permanece bloqueado antes da requisição',async()=>{
 const ui=loginUi('');
 await vm.runInContext('handleLogin({preventDefault(){}})',ui.context);
 assert.equal(ui.calls.length,0);
 assert.match(ui.alerts[0],/Informe a senha/);
 assert.equal(ui.fields.senha.focused,true);
});
