"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");
async function migrationManifest() {
    const dir=path.join(__dirname,"../database/sql");
    const files=(await fs.readdir(dir)).filter(file=>/^\d{3}_.+\.sql$/.test(file)).sort();
    const manifest=[];
    for(const nome of files) manifest.push({nome,checksum:crypto.createHash("sha256").update(await fs.readFile(path.join(dir,nome))).digest("hex")});
    return manifest;
}
async function readiness(db) {
    const [manifest,result]=await Promise.all([migrationManifest(),db.query("SELECT nome,checksum FROM schema_migrations")]);
    const applied=new Map(result.rows.map(row=>[row.nome,row.checksum]));
    return manifest.every(file=>applied.get(file.nome)===file.checksum);
}
module.exports={migrationManifest,readiness};
