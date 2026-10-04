"use strict";
const db=require("../database/connection");
async function release(client,venda) {
    // A reserva apenas retém disponibilidade; liberar não soma estoque físico.
    await client.query(`UPDATE reservas_estoque SET liberada_em=NOW()
        WHERE venda_id=$1 AND empresa_id=$2 AND confirmada_em IS NULL AND liberada_em IS NULL`,[venda.id,venda.empresa_id]);
}
async function expire() {
    return db.transaction(async client=>{
        const {rows}=await client.query(`SELECT id,empresa_id FROM vendas
            WHERE status='AGUARDANDO_PAGAMENTO' AND estoque_baixado_em IS NULL AND reserva_expira_em<NOW()
            ORDER BY reserva_expira_em LIMIT 100 FOR UPDATE SKIP LOCKED`);
        for(const order of rows) {
            await release(client,order);
            await client.query("UPDATE vendas SET status='CANCELADA',cancelado_em=NOW(),cancelamento_motivo='Reserva expirada' WHERE id=$1 AND empresa_id=$2",[order.id,order.empresa_id]);
        }
        return rows.length;
    });
}
function start() {
    const run=()=>expire().catch(()=>console.warn("[reservas] falha na liberação; nova tentativa em 60 segundos"));
    run(); setInterval(run,60000).unref();
}
module.exports={release,expire,start};
