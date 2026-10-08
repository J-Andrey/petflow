"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");
function migrationChecksum(sql) {
    return crypto.createHash("sha256").update(String(sql).replace(/\r\n?/g,"\n"),"utf8").digest("hex");
}
async function migrationManifest() {
    const dir=path.join(__dirname,"../database/sql");
    const files=(await fs.readdir(dir)).filter(file=>/^\d{3}_.+\.sql$/.test(file)).sort();
    const manifest=[];
    for(const nome of files) manifest.push({nome,checksum:migrationChecksum(await fs.readFile(path.join(dir,nome),"utf8"))});
    return manifest;
}
async function readiness(db) {
    const [manifest,result]=await Promise.all([migrationManifest(),db.query("SELECT nome,checksum FROM schema_migrations")]);
    const applied=new Map(result.rows.map(row=>[row.nome,row.checksum]));
    return manifest.every(file=>applied.get(file.nome)===file.checksum);
}
module.exports={migrationManifest,readiness};
