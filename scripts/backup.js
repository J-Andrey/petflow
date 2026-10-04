"use strict";
require("dotenv").config({quiet:true});
const fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");
const {buildDbOptions}=require("../config/dbOptions");
function run() {
    const mode=process.argv[2],file=process.argv[3];
    if(!["backup","restore"].includes(mode)||!file) throw new Error("Uso: node scripts/backup.js backup|restore arquivo.dump [--confirm-database nome]");
    const options=buildDbOptions();
    const url=options.connectionString?new URL(options.connectionString):null;
    const database=url?decodeURIComponent(url.pathname.slice(1)):options.database;
    if(!database)throw new Error("Banco não informado.");
    const env={...process.env,PGDATABASE:database,PGHOST:url?url.hostname:options.host,
        PGPORT:url?(url.port||"5432"):String(options.port||5432),
        PGUSER:url?decodeURIComponent(url.username):options.user,PGPASSWORD:url?decodeURIComponent(url.password):options.password};
    if(process.env.DB_SSL==="true")env.PGSSLMODE="require";
    function exec(binary,args){const r=spawnSync(binary,args,{env,stdio:["ignore","ignore","pipe"]});if(r.error||r.status!==0)throw new Error(binary+" falhou. Verifique a instalação, as permissões e a conexão; detalhes foram omitidos para proteger credenciais.");}
    const target=path.resolve(file);
    if(mode==="backup"){
        if(fs.existsSync(target))throw new Error("O arquivo já existe. Escolha outro destino.");
        fs.mkdirSync(path.dirname(target),{recursive:true});
        exec("pg_dump",["--format=custom","--no-owner","--no-acl","--file",target]);
        exec("pg_restore",["--list",target]);
        console.log("Backup criado e catálogo validado: "+target);
    }else{
        const flag=process.argv.indexOf("--confirm-database");
        if(flag<0||process.argv[flag+1]!==database)throw new Error("A restauração exige --confirm-database com o nome EXATO do banco configurado.");
        if(!fs.existsSync(target))throw new Error("Backup não encontrado.");
        exec("pg_restore",["--list",target]);
        // Não apaga objetos existentes: ensaiar em banco vazio separado.
        exec("pg_restore",["--exit-on-error","--single-transaction","--no-owner","--no-acl","--dbname",database,target]);
        console.log("Restauração concluída.");
    }
}
try{run();}catch(error){console.error(error.message);process.exitCode=1;}
