"use strict";
const crypto=require("node:crypto"),audit=require("./auditService");
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function automaticAllowed(order,tracking,now=Date.now(),env=process.env) {
    if(["ENTREGUE","FINALIZADA","CANCELADA"].includes(order.status))return false;
    if(!order.estoque_baixado_em)return true;
    const windowMinutes=Number(env.CANCELLATION_WINDOW_MINUTES||30);
    if(!Number.isFinite(windowMinutes)||windowMinutes<=0||now-new Date(order.data_venda).getTime()>windowMinutes*60000)return false;
    if(["PAGAMENTO_APROVADO","EM_SEPARACAO"].includes(order.status))return true;
    if(order.status!=="SAIU_PARA_ENTREGA"||!tracking)return false;
    const age=now-new Date(tracking.atualizado_em).getTime(),routeAge=now-new Date(tracking.rota_solicitada_em).getTime();
    const minimum=Number(env.CANCELLATION_MIN_DISTANCE_METERS||1000);
    return Number.isFinite(age)&&age>=0&&age<15000&&Number.isFinite(routeAge)&&routeAge>=0&&routeAge<30000&&
        tracking.precisao_m!=null&&Number(tracking.precisao_m)<=100&&Number.isFinite(minimum)&&minimum>0&&
        Number(tracking.rota?.distanceMeters)>minimum+100+(Number(tracking.velocidade)||30)*routeAge/1000;
}
async function openTicket(client,order,reason) {
    const existing=await client.query("SELECT protocolo FROM solicitacoes_consumidor WHERE empresa_id=$1 AND venda_id=$2 AND status IN ('RECEBIDA','EM_ANALISE')",[order.empresa_id,order.id]);
    if(existing.rows[0])return existing.rows[0].protocolo;
    const protocol="SAC-"+crypto.randomBytes(10).toString("hex").toUpperCase();
    await client.query(`INSERT INTO solicitacoes_consumidor(protocolo,empresa_id,cliente_id,venda_id,email_referencia,tipo,motivo)
        SELECT $1,$2,$3,$4,c.email,'CANCELAMENTO',$5 FROM clientes c WHERE c.id=$3 AND c.empresa_id=$2`,
        [protocol,order.empresa_id,order.cliente_id,order.id,reason]);
    return protocol;
}
async function requestCancellation(db,req,id,gateway) {
    const reason=String(req.body?.motivo||"").trim();
    if(reason.length<5||reason.length>500)fail("Informe um motivo entre 5 e 500 caracteres.");
    const principal=req.user||req.customer;
    const actor={...req,user:req.user||{id:null,empresaId:principal.empresaId}};
    const prepared=await db.transaction(async client=>{
        const result=await client.query("SELECT * FROM vendas WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[id,principal.empresaId]);
        const order=result.rows[0];
        if(!order||(req.customer&&order.cliente_id!==req.customer.id))fail("Pedido não encontrado.",404);
        if(order.status==="CANCELADA")return {status:"CANCELADA"};
        const existing=await client.query("SELECT * FROM reembolsos WHERE venda_id=$1 AND empresa_id=$2",[id,principal.empresaId]);
        if(existing.rows[0])return {refund:existing.rows[0]};
        const tracking=(await client.query("SELECT * FROM entrega_rastreamento WHERE venda_id=$1",[id])).rows[0];
        if(!automaticAllowed(order,tracking))return {status:"ATENDIMENTO",protocolo:await openTicket(client,order,reason)};
        if(!order.estoque_baixado_em){
            await require("./reservationService").release(client,order);
            await client.query("UPDATE vendas SET status='CANCELADA',cancelado_em=NOW(),cancelado_por=$1,cancelamento_motivo=$2 WHERE id=$3 AND empresa_id=$4",[req.user?.id||null,reason,id,principal.empresaId]);
            await audit.record(client,actor,"CANCELAR","vendas",id,order,{status:"CANCELADA"});
            return {status:"CANCELADA",notify:true};
        }
        if(!order.pagseguro_charge_id)return {status:"ATENDIMENTO",protocolo:await openTicket(client,order,reason)};
        const {rows}=await client.query(`INSERT INTO reembolsos(empresa_id,venda_id,chave_idempotencia,valor_centavos,motivo,solicitado_por)
            VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[order.empresa_id,id,"petflow-refund-"+id,Math.round(Number(order.valor_final)*100),reason,req.user?.id||null]);
        await client.query("UPDATE vendas SET reembolso_status='SOLICITADO' WHERE id=$1 AND empresa_id=$2",[id,order.empresa_id]);
        await audit.record(client,actor,"SOLICITAR_REEMBOLSO","vendas",id,order,{status:"SOLICITADO"});
        return {refund:rows[0]};
    });
    if(!prepared.refund)return prepared;
    try{
        const result=await db.transaction(async client=>{
            const order=(await client.query("SELECT * FROM vendas WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[id,principal.empresaId])).rows[0];
            const refund=(await client.query("SELECT * FROM reembolsos WHERE venda_id=$1 AND empresa_id=$2 FOR UPDATE",[id,principal.empresaId])).rows[0];
            if(refund.status==="CONCLUIDO")return {status:"CANCELADA"};
            let charge=await gateway.consultarCobranca(order.pagseguro_charge_id);
            const cents=Number(refund.valor_centavos);
            if(!Number.isSafeInteger(Number(charge.amount?.summary?.refunded)))fail("PagBank não retornou um resumo válido da cobrança.",502);
            if(Number(charge.amount.summary.refunded)<cents&&refund.status==="SOLICITADO"){
                charge=await gateway.reembolsar(order.pagseguro_charge_id,cents,refund.chave_idempotencia);
            }
            if(!Number.isSafeInteger(Number(charge.amount?.summary?.refunded))||Number(charge.amount.summary.refunded)<cents){
                await client.query("UPDATE reembolsos SET status='PROCESSANDO',updated_at=NOW() WHERE id=$1",[refund.id]);
                await client.query("UPDATE vendas SET reembolso_status='PROCESSANDO' WHERE id=$1",[id]);
                return {status:"PROCESSANDO",message:"Reembolso aguardando confirmação do PagBank. Consulte novamente."};
            }
            if(charge.id!==order.pagseguro_charge_id)fail("Identificador do reembolso divergente.",502);
            await client.query("SELECT set_config('petflow.referencia_tipo','REEMBOLSO',TRUE),set_config('petflow.referencia_id',$1,TRUE)",[id]);
            if(!order.estoque_devolvido_em){
                const items=await client.query("SELECT produto_id,quantidade FROM itens_venda WHERE venda_id=$1 AND empresa_id=$2 ORDER BY produto_id",[id,order.empresa_id]);
                for(const item of items.rows)await client.query("UPDATE estoque SET quantidade=quantidade+$1 WHERE empresa_id=$2 AND produto_id=$3",[item.quantidade,order.empresa_id,item.produto_id]);
                await client.query("UPDATE vendas SET estoque_devolvido_em=NOW() WHERE id=$1",[id]);
            }
            await client.query("UPDATE financeiro SET status='CANCELADO',valor_pago=0 WHERE empresa_id=$1 AND origem='VENDA' AND referencia_id=$2",[order.empresa_id,id]);
            await client.query("UPDATE reembolsos SET status='CONCLUIDO',provedor_id=$1,updated_at=NOW() WHERE id=$2",[charge.id,refund.id]);
            await client.query("UPDATE vendas SET status='CANCELADA',reembolso_status='CONCLUIDO',reembolso_id=$1,cancelado_em=NOW(),cancelado_por=$2,cancelamento_motivo=$3 WHERE id=$4",[charge.id,refund.solicitado_por,refund.motivo,id]);
            await audit.record(client,actor,"REEMBOLSAR","vendas",id,order,{status:"CANCELADA"});
            return {status:"CANCELADA",notify:true};
        });
        return result;
    }catch(error){
        await db.query("UPDATE reembolsos SET status='INCERTO',updated_at=NOW() WHERE venda_id=$1 AND empresa_id=$2 AND status<>'CONCLUIDO'",[id,principal.empresaId]);
        await db.query("UPDATE vendas SET reembolso_status='INCERTO' WHERE id=$1 AND empresa_id=$2 AND reembolso_status<>'CONCLUIDO'",[id,principal.empresaId]);
        throw error;
    }
}
module.exports={automaticAllowed,requestCancellation};
