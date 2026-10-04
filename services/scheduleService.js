"use strict";
const {UUID}=require("./sessionService"),audit=require("./auditService");
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const transitions={AGENDADO:["CONFIRMADO","CANCELADO","FALTOU"],CONFIRMADO:["EM_ANDAMENTO","CANCELADO","FALTOU"],EM_ANDAMENTO:["CONCLUIDO","CANCELADO"],CONCLUIDO:[],CANCELADO:[],FALTOU:[]};
function validate(data) {
    if(!UUID.test(data.clienteId)||!UUID.test(data.petId)||(data.funcionarioId&&!UUID.test(data.funcionarioId))||
        !/^\d{4}-\d{2}-\d{2}$/.test(data.data)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.hora)||
        !transitions[data.status])fail("Dados do agendamento inválidos.");
    const date=new Date(data.data+"T12:00:00Z");
    if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==data.data)fail("Data inválida.");
    if(data.status==="CANCELADO"&&(!data.motivo||String(data.motivo).trim().length<3))fail("Informe o motivo do cancelamento.");
}
async function save(db,req,data,id) {
    validate(data);
    const principal=req.user||req.customer,company=principal.empresaId;
    return db.transaction(async client=>{
        await client.query("SELECT id FROM empresas WHERE id=$1 FOR UPDATE",[company]);
        const before=id?(await client.query("SELECT * FROM agendamentos WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[id,company])).rows[0]:null;
        if(id&&!before)fail("Agendamento não encontrado.",404);
        if(before&&before.status!==data.status&&!transitions[before.status]?.includes(data.status))fail("Transição de agendamento inválida.",409);
        if(before&&["CONCLUIDO","CANCELADO","FALTOU"].includes(before.status))fail("Agendamento encerrado não pode ser alterado.",409);
        if(req.customer&&data.clienteId!==req.customer.id)fail("Cliente inválido.",403);
        const pet=await client.query(`SELECT p.id FROM pets p JOIN clientes c ON c.id=p.cliente_id
            WHERE p.id=$1 AND p.cliente_id=$2 AND p.empresa_id=$3 AND c.empresa_id=$3 AND p.ativo=TRUE AND c.ativo=TRUE`,[data.petId,data.clienteId,company]);
        if(!pet.rowCount)fail("Pet ou cliente não pertence à empresa.");
        const service=await client.query(`SELECT id,nome,preco,duracao FROM servicos WHERE empresa_id=$1 AND ativo=TRUE
            AND (id::text=$2 OR nome=$2) ORDER BY id LIMIT 2`,[company,data.servicoId||data.servico]);
        if(service.rows.length!==1)fail("Selecione um serviço válido.");
        if(data.funcionarioId){
            const staff=await client.query("SELECT id FROM funcionarios WHERE id=$1 AND empresa_id=$2 AND status=TRUE",[data.funcionarioId,company]);
            if(!staff.rowCount)fail("Funcionário indisponível.");
        }
        const duration=Math.max(1,Math.min(1440,Number(service.rows[0].duracao)||30));
        if(!before || before.data_agendamento?.toISOString?.().slice(0,10)!==data.data || String(before.horario).slice(0,5)!==data.hora) {
            const now=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date());
            if(data.status!=="CANCELADO"&&data.data+" "+data.hora<now)fail("Escolha uma data e horário futuros.");
        }
        if(!["CANCELADO","FALTOU","CONCLUIDO"].includes(data.status)){
            const conflict=await client.query(`SELECT id FROM agendamentos WHERE empresa_id=$1 AND id<>COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
                AND status IN ('AGENDADO','CONFIRMADO','EM_ANDAMENTO') AND (pet_id=$3 OR ($4::uuid IS NOT NULL AND funcionario_id=$4))
                AND (data_agendamento+horario)<($5::date+$6::time+make_interval(mins=>$7))
                AND (data_agendamento+horario+make_interval(mins=>duracao_minutos))>($5::date+$6::time)`,
                [company,id||null,data.petId,data.funcionarioId||null,data.data,data.hora,duration]);
            if(conflict.rowCount)fail("Há conflito de horário para o pet ou funcionário.",409);
        }
        const values=[company,data.clienteId,data.petId,data.funcionarioId||null,service.rows[0].id,service.rows[0].nome,data.data,data.hora,service.rows[0].preco,duration,data.status,data.observacoes||null,data.motivo||null,req.user?.id||null];
        const result=id?await client.query(`UPDATE agendamentos SET cliente_id=$2,pet_id=$3,funcionario_id=$4,servico_id=$5,servico=$6,
            data_agendamento=$7,data=$7,horario=$8,hora=$8,valor=$9,duracao_minutos=$10,status=$11,observacoes=$12,cancelamento_motivo=$13,alterado_por=$14
            WHERE empresa_id=$1 AND id=$15 RETURNING *`,[...values,id]):
            await client.query(`INSERT INTO agendamentos(empresa_id,cliente_id,pet_id,funcionario_id,servico_id,servico,data_agendamento,horario,valor,duracao_minutos,status,observacoes,cancelamento_motivo,alterado_por)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,values);
        const saved=result.rows[0];
        await audit.record(client,{...req,user:req.user||{id:null,empresaId:company}},"AGENDAMENTO","agendamentos",saved.id,before,saved);
        await client.query("INSERT INTO notificacoes(cliente_id,titulo,mensagem,tipo) VALUES($1,'Agendamento atualizado',$2,'AGENDAMENTO')",
            [data.clienteId,service.rows[0].nome+" em "+data.data+" às "+data.hora+": "+data.status]);
        return saved;
    });
}
module.exports={save,validate,transitions};
