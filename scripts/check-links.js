"use strict";
const fs=require("node:fs"),path=require("node:path");
const root=path.join(__dirname,".."),app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const routes=[...app.matchAll(/app\.get\("([^"]+)"/g)].map(match=>new RegExp("^"+match[1].replace(/:[^/]+/g,"[^/]+")+"$"));
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(dir,item.name)):item.name.endsWith(".html")?[path.join(dir,item.name)]:[]);}
let failures=0,count=0;
for(const file of ["views","admin","public"].flatMap(dir=>walk(path.join(root,dir)))) {
    const html=fs.readFileSync(file,"utf8");
    for(const [,raw] of html.matchAll(/(?:href|src)=["']([^"'<>]+)["']/g)) {
        if(!raw.startsWith("/")||raw.startsWith("//"))continue;
        const url=raw.split(/[?#]/)[0];count++;
        const staticPath=path.join(root,url.startsWith("/admin/")?"":"public",url);
        if(!fs.existsSync(staticPath)&&!routes.some(route=>route.test(url))){
            console.error(path.relative(root,file)+": "+url);failures++;
        }
    }
}
console.log(count+" links locais verificados; "+failures+" inválido(s).");
process.exitCode=failures?1:0;
