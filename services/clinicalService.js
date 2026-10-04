"use strict";
const {UUID}=require("./sessionService"),audit=require("./auditService");
const definitions={
    consultas:{fields:["pet_id","cliente_id","data_consulta","horario","peso","temperatura","motivo_consulta","status","observacoes"],required:["pet_id","cliente_id","data_consulta","horario","motivo_consulta","status"]},
    prontuarios:{fields:["consulta_id","diagnostico","tratamento","medicamentos","receita","exames_solicitados","observacoes","retorno"],required:["consulta_id","diagnostico"]},
    vacinas:{fields:["nome","fabricante","descricao","intervalo_dias","ativo"],required:["nome","ativo"]},
    historico_vacinas:{fields:["pet_id","vacina_id","consulta_id","data_aplicacao","proxima_dose","lote","fabricante","observacoes"],required:["pet_id","vacina_id","data_aplicacao"]}
};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function validate(kind,data){
    const definition=definitions[kind];if(!definition)fail("Módulo inválido.");
    for(const field of definition.required)if(data[field]===undefined||data[field]===null||data[field]==="")fail("Preencha "+field+".");
    for(const field of definition.fields){
        const value=data[field];if(value==null||value==="")continue;
        if(field.endsWith("_id")&&!UUID.test(value))fail("Identificador inválido.");
        if(["data_consulta","data_aplicacao","proxima_dose","retorno"].includes(field)&&
            (!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(new Date(value).getTime())||new Date(value).toISOString().slice(0,10)!==value))fail("Data inválida.");
        if(typeof value==="string"&&value.length>5000)fail("Texto muito longo.");
    }
    if(kind==="consultas"){
        if(!["AGENDADA","EM_ANDAMENTO","CONCLUIDA","CANCELADA"].includes(data.status)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.horario))fail("Status ou horário inválido.");
        if(data.peso!=null&&data.peso!==""&&(!Number.isFinite(Number(data.peso))||Number(data.peso)<0||Number(data.peso)>999))fail("Peso inválido.");
        if(data.temperatura!=null&&data.temperatura!==""&&(!Number.isFinite(Number(data.temperatura))||Number(data.temperatura)<20||Number(data.temperatura)>50))fail("Temperatura inválida.");
    }
    if(kind==="vacinas"&&(typeof data.ativo!=="boolean"||(data.intervalo_dias!=null&&data.intervalo_dias!==""&&(!Number.isInteger(Number(data.intervalo_dias))||Number(data.intervalo_dias)<=0))))fail("Status ou intervalo inválido.");
    if(data.proxima_dose&&data.proxima_dose<data.data_aplicacao)fail("A próxima dose deve ser posterior à aplicação.");
}
async function save(db,req,kind,id) {
    const data=req.body;validate(kind,data);const company=req.user.empresaId;
    return db.transaction(async client=>{
        const before=id?(await client.query("SELECT * FROM "+kind+" WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[id,company])).rows[0]:null;
        if(id&&!before)fail("Registro não encontrado.",404);
        if(data.pet_id){
            const pet=await client.query("SELECT cliente_id FROM pets WHERE id=$1 AND empresa_id=$2",[data.pet_id,company]);
            if(!pet.rows[0]||(data.cliente_id&&pet.rows[0].cliente_id!==data.cliente_id))fail("Pet ou tutor inválido.");
        }
        if(data.consulta_id){
            const consultation=await client.query("SELECT pet_id FROM consultas WHERE id=$1 AND empresa_id=$2",[data.consulta_id,company]);
            if(!consultation.rows[0]||(data.pet_id&&consultation.rows[0].pet_id!==data.pet_id))fail("Consulta inválida.");
        }
        if(data.vacina_id&&!(await client.query("SELECT id FROM vacinas WHERE id=$1 AND empresa_id=$2 AND ativo=TRUE",[data.vacina_id,company])).rowCount)fail("Vacina indisponível.");
        const fields=definitions[kind].fields;
        const values=fields.map(field=>data[field]===""||data[field]===undefined?null:data[field]);
        const companyIndex=values.push(company);
        let result;
        if(id){const idIndex=values.push(id);result=await client.query("UPDATE "+kind+" SET "+fields.map((field,i)=>field+"=$"+(i+1)).join(",")+",updated_at=NOW() WHERE empresa_id=$"+companyIndex+" AND id=$"+idIndex+" RETURNING *",values);}
        else result=await client.query("INSERT INTO "+kind+" ("+fields.join(",")+",empresa_id) VALUES("+values.map((_,i)=>"$"+(i+1)).join(",")+") RETURNING *",values);
        const saved=result.rows[0];await audit.record(client,req,id?"CORRIGIR":"CRIAR",kind,saved.id,before,saved);return saved;
    });
}
module.exports={definitions,validate,save};
