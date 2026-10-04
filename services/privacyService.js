"use strict";
const audit=require("./auditService");
async function processRequest(db,req,id){
    return db.transaction(async client=>{
        const result=await client.query("SELECT * FROM lgpd_solicitacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[id,req.user.empresaId]);
        const item=result.rows[0];
        const fail=message=>{throw Object.assign(new Error(message),{status:409});};
        if(!item||!["ABERTA","EM_ANALISE"].includes(item.status))fail("Solicitação indisponível.");
        if(!["EXCLUSAO","ANONIMIZACAO","REVOGACAO"].includes(item.tipo))fail("Responda este tipo de solicitação pelo atendimento.");
        if(req.body.confirmacao!=="PROCESSAR")fail("Confirme expressamente o processamento.");
        if(item.tipo==="REVOGACAO"&&req.body.finalidade!=="NEWSLETTER")fail("Informe a finalidade NEWSLETTER para revogar esse consentimento. Outras finalidades exigem análise e resposta específica.");
        const customer=(await client.query("SELECT * FROM clientes WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[item.cliente_id,req.user.empresaId])).rows[0];
        if(!customer)fail("Titular não encontrado.");
        if(item.tipo!=="REVOGACAO"){
            const records=await client.query(`SELECT EXISTS(SELECT 1 FROM vendas WHERE cliente_id=$1 AND empresa_id=$2)
                OR EXISTS(SELECT 1 FROM agendamentos WHERE cliente_id=$1 AND empresa_id=$2)
                OR EXISTS(SELECT 1 FROM consultas WHERE cliente_id=$1 AND empresa_id=$2)
                OR EXISTS(SELECT 1 FROM historico_vacinas h JOIN pets p ON p.id=h.pet_id AND p.empresa_id=h.empresa_id WHERE p.cliente_id=$1 AND h.empresa_id=$2)
                OR EXISTS(SELECT 1 FROM solicitacoes_consumidor WHERE cliente_id=$1 AND empresa_id=$2) AS retention`,[customer.id,req.user.empresaId]);
            if(records.rows[0].retention)fail("O titular possui histórico comercial, de agenda ou clínico. Registre a análise de retenção antes de qualquer anonimização; esta operação automática foi bloqueada.");
            const anonymous="anon-"+customer.id+"@invalid.example";
            await client.query(`UPDATE clientes SET nome='Titular anonimizado',cpf=NULL,data_nascimento=NULL,telefone='REMOVIDO',whatsapp=NULL,
                email=$1,cep=NULL,endereco=NULL,numero=NULL,complemento=NULL,bairro=NULL,cidade=NULL,estado=NULL,observacoes=NULL,
                ativo=FALSE,anonimizado_em=NOW() WHERE id=$2 AND empresa_id=$3`,[anonymous,customer.id,req.user.empresaId]);
            await client.query("UPDATE usuarios_clientes SET email=$1,ativo=FALSE,sessao_versao=sessao_versao+1,token_recuperacao=NULL,token_expiracao=NULL,token_verificacao_email=NULL,token_verificacao_expiracao=NULL WHERE cliente_id=$2",[anonymous,customer.id]);
            await client.query("UPDATE pets SET observacoes=NULL,ativo=FALSE WHERE cliente_id=$1 AND empresa_id=$2",[customer.id,req.user.empresaId]);
            await client.query("UPDATE lgpd_solicitacoes SET email_referencia=NULL WHERE cliente_id=$1 AND empresa_id=$2",[customer.id,req.user.empresaId]);
        }
        await client.query("DELETE FROM newsletter_inscritos WHERE empresa_id=$1 AND LOWER(email)=LOWER($2)",[req.user.empresaId,customer.email]);
        await client.query("INSERT INTO lgpd_consentimentos(empresa_id,cliente_id,finalidade,versao,concedido,origem) VALUES($1,$2,'NEWSLETTER',$3,FALSE,'ADMIN')",[req.user.empresaId,customer.id,process.env.PRIVACY_POLICY_VERSION||"2026-10-04"]);
        const answer=item.tipo==="REVOGACAO"?"Consentimento para newsletter revogado. Outros tratamentos seguem as bases aplicáveis; solicite informação para detalhamento.":"Dados cadastrais não sujeitos à retenção foram anonimizados e as sessões foram revogadas.";
        await client.query("UPDATE lgpd_solicitacoes SET status='ATENDIDA',resposta=$1,atendida_em=NOW(),atendida_por=$2,updated_at=NOW() WHERE id=$3 AND empresa_id=$4",[answer,req.user.id,id,req.user.empresaId]);
        await client.query("INSERT INTO notificacoes(cliente_id,titulo,mensagem,tipo) VALUES($1,$2,$3,'SISTEMA')",[customer.id,"Resposta ao protocolo "+item.protocolo,answer]);
        await audit.record(client,req,"PROCESSAR_LGPD","lgpd_solicitacoes",id,null,{status:"ATENDIDA",protocolo:item.protocolo});
        return {protocolo:item.protocolo,resposta:answer,email:customer.email};
    });
}
module.exports={processRequest};
