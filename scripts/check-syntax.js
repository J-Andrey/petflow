"use strict";
const fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");
function walk(dir) {
    return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
        if(["node_modules",".git",".backups"].includes(entry.name))return [];
        const name=path.join(dir,entry.name);
        return entry.isDirectory()?walk(name):name.endsWith(".js")?[name]:[];
    });
}
let failed=0;
const files=walk(path.join(__dirname,".."));
for(const file of files) {
    const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
    if(result.status!==0){console.error(path.relative(process.cwd(),file),result.stderr);failed++;}
}
console.log(files.length+" arquivos JavaScript verificados; "+failed+" falha(s).");
process.exitCode=failed?1:0;
