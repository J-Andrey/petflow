"use strict";
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module");
// Carrega unidades com dependências explícitas. Nunca lê .env nem abre conexão.
function load(relative,mocks={}) {
    const filename=path.resolve(__dirname,"..",relative);
    const unit=new Module(filename,module);
    unit.filename=filename;unit.paths=Module._nodeModulePaths(path.dirname(filename));
    unit.require=function(name) {
        if(Object.hasOwn(mocks,name))return mocks[name];
        if(/connection|config\/env|config\/db|emailService/.test(name))throw new Error("Dependência externa não isolada: "+name);
        return Module.prototype.require.call(this,name);
    };
    unit._compile(fs.readFileSync(filename,"utf8"),filename);
    return unit.exports;
}
function response() {
    return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
}
module.exports={load,response};
