"use strict";
const bcrypt = require("bcrypt");
const { validPassword, UUID } = require("./sessionService");
const audit = require("./auditService");
const fail = (message,status=400) => { throw Object.assign(new Error(message), {status}); };
function validate(data, creating) {
    if (typeof data.nome!=="string" || data.nome.trim().length<3 || data.nome.length>150) fail("Nome inválido.");
    if (typeof data.email!=="string" || data.email.length>150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail("E-mail inválido.");
    if (!["ADMIN","GERENTE"].includes(data.perfil) || typeof data.ativo!=="boolean") fail("Perfil ou status inválido.");
    if ((creating || data.senha) && !validPassword(data.senha)) fail("A senha deve ter entre 8 e 72 bytes.");
}
function protectSelf(actorId,id,current,data) {
    if (actorId===id && !data.ativo) fail("Você não pode desativar sua própria conta.",409);
    if (actorId===id && current.perfil==="ADMIN" && data.perfil!=="ADMIN") fail("Você não pode rebaixar seu próprio perfil.",409);
}
async function save(db,request,id) {
    const data=request.body;
    validate(data,!id);
    if(id && !UUID.test(id)) fail("Identificador inválido.");
    const senhaHash=data.senha ? await bcrypt.hash(data.senha,12) : null;
    return db.transaction(async client=>{
        // A mesma linha serializa todas as alterações da equipe da empresa.
        await client.query("SELECT id FROM empresas WHERE id=$1 FOR UPDATE",[request.user.empresaId]);
        // Revalidar a autorização dentro da transação após aguardar o lock.
        const actor=await client.query("SELECT id FROM usuarios WHERE id=$1 AND empresa_id=$2 AND ativo=TRUE AND perfil='ADMIN' AND sessao_versao=$3",
            [request.user.id,request.user.empresaId,request.user.sessao_versao]);
        if(!actor.rowCount) fail("Sessão revogada.",401);
        let before=null,result;
        if(id) {
            const found=await client.query("SELECT id,nome,email,perfil,ativo FROM usuarios WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[id,request.user.empresaId]);
            before=found.rows[0];
            if(!before) fail("Usuário não encontrado.",404);
            protectSelf(request.user.id,id,before,data);
            if(before.perfil==="ADMIN" && before.ativo && (data.perfil!=="ADMIN" || !data.ativo)) {
                const admins=await client.query("SELECT id FROM usuarios WHERE empresa_id=$1 AND perfil='ADMIN' AND ativo=TRUE AND id<>$2",[request.user.empresaId,id]);
                if(!admins.rowCount) fail("A empresa precisa manter ao menos um administrador ativo.",409);
            }
            result=await client.query(`UPDATE usuarios SET nome=$1,email=$2,perfil=$3,ativo=$4,
                senha_hash=COALESCE($5,senha_hash) WHERE id=$6 AND empresa_id=$7 RETURNING id,nome,email,perfil,ativo`,
                [data.nome.trim(),data.email.trim().toLowerCase(),data.perfil,data.ativo,senhaHash,id,request.user.empresaId]);
        } else {
            result=await client.query(`INSERT INTO usuarios(empresa_id,nome,email,perfil,ativo,senha_hash)
                VALUES($1,$2,$3,$4,$5,$6) RETURNING id,nome,email,perfil,ativo`,
                [request.user.empresaId,data.nome.trim(),data.email.trim().toLowerCase(),data.perfil,data.ativo,senhaHash]);
        }
        const saved=result.rows[0];
        await audit.record(client,request,id?"ATUALIZAR":"CRIAR","usuarios",saved.id,before,saved);
        return saved;
    });
}
module.exports = {save,validate,protectSelf};
