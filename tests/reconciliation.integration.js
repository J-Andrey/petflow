"use strict";
// Helper chamado somente pelo banco PostgreSQL descartável do integration runner.
const assert = require("node:assert/strict"), crypto = require("node:crypto");
module.exports = async function reconciliationScenarios({ db, company, actor, other }) {
    const reconciliation = require("../services/paymentReconciliationService"), returns = require("../services/returnService");
    const marker = crypto.randomBytes(5).toString("hex");
    const customer = (await db.query("INSERT INTO clientes(empresa_id,nome,email,telefone) VALUES($1,'Devolução teste',$2,'11970000003') RETURNING id", [company, marker + "@example.test"])).rows[0].id;
    const category = (await db.query("INSERT INTO categorias(empresa_id,nome) VALUES($1,$2) RETURNING id", [company, "Devolução " + marker])).rows[0].id;
    const product = (await db.query("INSERT INTO produtos(empresa_id,categoria_id,nome,preco) VALUES($1,$2,'Produto devolução',10) RETURNING id", [company, category])).rows[0].id;
    await db.query("INSERT INTO estoque(empresa_id,produto_id,quantidade) VALUES($1,$2,10)", [company, product]);
    const order = (await db.query("INSERT INTO vendas(empresa_id,cliente_id,forma_pagamento,status,estoque_baixado_em,entregue_em,pagseguro_charge_id) VALUES($1,$2,'PIX','ENTREGUE',NOW(),NOW(),$3) RETURNING id", [company, customer, "CHAR_" + marker])).rows[0];
    await db.query("INSERT INTO itens_venda(empresa_id,venda_id,produto_id,quantidade,preco_unitario,subtotal) VALUES($1,$2,$3,4,10,40)", [company, order.id, product]);
    await db.query("UPDATE vendas SET valor_total=40 WHERE id=$1",[order.id]);
    await db.query("INSERT INTO financeiro(empresa_id,tipo,origem,referencia_id,descricao,valor,valor_pago,data_vencimento,data_pagamento,status) VALUES($1,'RECEBER','VENDA',$2,'Receita teste',40,40,CURRENT_DATE,CURRENT_DATE,'PAGO')", [company, order.id]);
    const chargeId = "CHAR_" + marker;
    let refunded = 0, refundCalls = 0;
    const snapshot = () => ({ id: chargeId, reference_id: order.id, status: "PAID", amount: { value: 4000, currency: "BRL", summary: { total: 4000, paid: 4000, refunded } } });
    const gateway = { async consultarCobranca(id) { assert.equal(id, chargeId); return snapshot(); }, async reembolsar(id, value) { assert.equal(id, chargeId); refundCalls++; refunded += value; return snapshot(); } };
    const request = body => ({ ...actor, body });
    // Parcial externo, chamadas simultâneas e evento antigo: não duplicam financeiro/estoque.
    refunded = 500;
    await Promise.all([reconciliation.reconcile(db, request({}), order.id, gateway), reconciliation.reconcile(db, request({}), order.id, gateway)]);
    refunded = 200;
    assert.equal((await reconciliation.reconcile(db, request({}), order.id, gateway)).ignorado, true);
    refunded = 500;
    assert.equal(Number((await db.query("SELECT SUM(valor_pago) AS valor FROM financeiro WHERE empresa_id=$1 AND origem='ESTORNO'", [company])).rows[0].valor) >= 5, true);
    assert.equal((await db.query("SELECT quantidade FROM estoque WHERE produto_id=$1", [product])).rows[0].quantidade, 10);
    // Atendimento de devolução, aprovação idempotente e bloqueio do reembolso prematuro.
    const ticket = (await db.query("INSERT INTO solicitacoes_consumidor(protocolo,empresa_id,cliente_id,venda_id,tipo,motivo) VALUES($1,$2,$3,$4,'DEVOLUCAO','Cliente solicita devolução parcial') RETURNING id", ["SAC-" + marker, company, customer, order.id])).rows[0].id;
    const approve = request({ valor_centavos: 1000, motivo: "Devolução de uma unidade aprovada.", itens: [{ produto_id: product, quantidade: 1 }] });
    const approved = await Promise.all([returns.approve(db, approve, ticket, gateway), returns.approve(db, approve, ticket, gateway)]);
    assert.equal(approved[0].id, approved[1].id);
    const returnId = approved[0].id;
    await assert.rejects(returns.refund(db, request({}), returnId, gateway), { status: 409 });
    assert.equal(refundCalls, 0);
    const receive = request({ observacao: "Unidade fisicamente recebida e apta para venda.", itens: [{ produto_id: product, repor_estoque: true }] });
    await Promise.all([returns.receive(db, receive, returnId), returns.receive(db, receive, returnId)]);
    assert.equal((await db.query("SELECT quantidade FROM estoque WHERE produto_id=$1", [product])).rows[0].quantidade, 11);
    const results = await Promise.all([returns.refund(db, request({}), returnId, gateway), returns.refund(db, request({}), returnId, gateway)]);
    assert.equal(refundCalls, 1); assert.ok(results.some(r => r.status === "CONCLUIDA"));
    assert.ok(results.every(r => ["CONCLUIDA","PROCESSANDO"].includes(r.status)));
    assert.equal((await db.query("SELECT status FROM vendas WHERE id=$1", [order.id])).rows[0].status, "ENTREGUE");
    assert.equal((await db.query("SELECT status FROM solicitacoes_consumidor WHERE id=$1", [ticket])).rows[0].status, "ATENDIDA");
    assert.equal(Number((await db.query("SELECT SUM(f.valor_pago) AS valor FROM financeiro f JOIN conciliacao_eventos e ON e.financeiro_id=f.id WHERE e.venda_id=$1 AND f.origem='ESTORNO'", [order.id])).rows[0].valor), 15);
    assert.equal(Number((await db.query("SELECT valor_pago FROM financeiro WHERE origem='VENDA' AND referencia_id=$1", [order.id])).rows[0].valor_pago), 40);
    // Estado em análise e defesa negada não provam perda; LOST e WON geram compensação.
    const chargebackId = "CBKS_" + marker;
    let status = "AWAITING_EVIDENCE", day = 1;
    gateway.consultarChargeback = async () => ({ id: chargebackId, status, updated_at: "2026-10-0" + day + "T12:00:00Z", amount: { value: 500, currency: "BRL" }, transaction: { reference_id: order.id, amount: 4000 } });
    await reconciliation.reconcile(db, request({ chargeback_id: chargebackId }), order.id, gateway);
    status = "LOST"; day = 2;
    await Promise.all([reconciliation.reconcile(db, request({ chargeback_id: chargebackId }), order.id, gateway), reconciliation.reconcile(db, request({ chargeback_id: chargebackId }), order.id, gateway)]);
    status = "AWAITING_EVIDENCE"; day = 1;
    assert.equal((await reconciliation.reconcile(db, request({ chargeback_id: chargebackId }), order.id, gateway)).chargeback.ignorado, true);
    status = "WON"; day = 3;
    await reconciliation.reconcile(db, request({ chargeback_id: chargebackId }), order.id, gateway);
    await reconciliation.reconcile(db, request({ chargeback_id: chargebackId }), order.id, gateway);
    const losses = await db.query("SELECT origem,COUNT(*)::integer AS n,SUM(valor_pago)::text AS valor FROM financeiro f JOIN conciliacao_eventos e ON e.financeiro_id=f.id WHERE e.venda_id=$1 AND f.origem IN ('CHARGEBACK','REVERSAO_CHARGEBACK') GROUP BY origem ORDER BY origem", [order.id]);
    assert.deepEqual(losses.rows.map(r => [r.origem, r.n, Number(r.valor)]), [["CHARGEBACK", 1, 5], ["REVERSAO_CHARGEBACK", 1, 5]]);
    assert.equal((await db.query("SELECT quantidade FROM estoque WHERE produto_id=$1", [product])).rows[0].quantidade, 11);
    await assert.rejects(reconciliation.reconcile(db, { ...actor, user: { ...actor.user, empresaId: other }, body: {} }, order.id, gateway), { status: 404 });
    await assert.rejects(returns.receive(db, { ...receive, user: { ...actor.user, empresaId: other } }, returnId), { status: 404 });
    await assert.rejects(returns.approve(db, { ...approve, user: { ...actor.user, empresaId: other } }, ticket, gateway), { status: 404 });
    await reconciliation.review(db, request({ status: "CONCILIADO", resposta: "Estornos, crédito da disputa e devolução conferidos." }), order.id);
    // Uma resposta perdida mantém tentativa durável; consultas posteriores não enviam de novo.
    const uncertainTicket=(await db.query("INSERT INTO solicitacoes_consumidor(protocolo,empresa_id,cliente_id,venda_id,tipo,motivo) VALUES($1,$2,$3,$4,'DEVOLUCAO','Segunda devolução autorizada') RETURNING id",["SAC-LOSS-"+marker,company,customer,order.id])).rows[0].id;
    const uncertainReturn=await returns.approve(db,request({valor_centavos:500,motivo:"Devolução de item com embalagem avariada.",itens:[{produto_id:product,quantidade:1}]}),uncertainTicket,gateway);
    await returns.receive(db,request({observacao:"Produto recebido sem condições de revenda.",itens:[{produto_id:product,repor_estoque:false}]}),uncertainReturn.id);
    assert.equal((await db.query("SELECT quantidade FROM estoque WHERE produto_id=$1",[product])).rows[0].quantidade,11);
    let lostCalls=0;
    const lostGateway={consultarCobranca:gateway.consultarCobranca,async reembolsar(){lostCalls++;refunded+=500;throw new Error("Resposta perdida após aceite do provedor.");}};
    await assert.rejects(returns.refund(db,request({}),uncertainReturn.id,lostGateway));
    assert.equal((await db.query("SELECT status FROM reembolsos WHERE devolucao_id=$1",[uncertainReturn.id])).rows[0].status,"INCERTO");
    assert.equal((await returns.refund(db,request({}),uncertainReturn.id,lostGateway)).status,"CONCLUIDA");
    assert.equal(lostCalls,1);
    // Cancelamento em rota estorna, mas só recebimento físico explícito repõe mercadoria.
    // PostgreSQL e Date.now() podem diferir em 1 ms no mesmo aparelho.
    // Use uma observação recente já passada, sem flexibilizar a rejeição de GPS futuro.
    const routeObserved = new Date(Date.now() - 1000);
    const routeOrder=(await db.query("INSERT INTO vendas(empresa_id,cliente_id,forma_pagamento,status,data_venda,estoque_baixado_em,pagseguro_charge_id) VALUES($1,$2,'PIX','SAIU_PARA_ENTREGA',$4,$4,$3) RETURNING id",[company,customer,"CHAR_ROUTE_"+marker,routeObserved])).rows[0];
    await db.query("INSERT INTO itens_venda(empresa_id,venda_id,produto_id,quantidade,preco_unitario,subtotal) VALUES($1,$2,$3,1,10,10)",[company,routeOrder.id,product]);
    await db.query("UPDATE vendas SET valor_total=10 WHERE id=$1",[routeOrder.id]);
    await db.query("INSERT INTO entrega_rastreamento(venda_id,token_hash,expira_em,atualizado_em,observado_em,precisao_m,rota_solicitada_em,rota) VALUES($1,$2,NOW()+INTERVAL '1 hour',$3,$3,10,$3,$4)",[routeOrder.id,crypto.randomBytes(32).toString("hex"),routeObserved,{distanceMeters:3000,origem_gps_observado_em:routeObserved.toISOString()}]);
    let routeRefund=0;
    const routeSnapshot=()=>({id:"CHAR_ROUTE_"+marker,reference_id:routeOrder.id,status:routeRefund?"CANCELED":"PAID",amount:{currency:"BRL",value:1000,summary:{total:1000,paid:1000,refunded:routeRefund}}});
    const routeGateway={async consultarCobranca(){return routeSnapshot();},async reembolsar(){routeRefund=1000;return routeSnapshot();}};
    const cancelled=await require("../services/cancellationService").requestCancellation(db,request({motivo:"Cancelamento distante do destino."}),routeOrder.id,routeGateway);
    assert.equal(cancelled.status,"CANCELADA");assert.match(cancelled.protocolo,/^SAC-/);
    assert.equal((await db.query("SELECT quantidade FROM estoque WHERE produto_id=$1",[product])).rows[0].quantidade,11);
    const routeTicket=(await db.query("SELECT id FROM solicitacoes_consumidor WHERE protocolo=$1",[cancelled.protocolo])).rows[0].id;
    const routeReturn=await returns.approve(db,request({valor_centavos:0,motivo:"Reembolso já realizado; receber mercadoria.",itens:[{produto_id:product,quantidade:1}]}),routeTicket,routeGateway);
    await returns.receive(db,request({observacao:"Entregador devolveu o produto lacrado.",itens:[{produto_id:product,repor_estoque:true}]}),routeReturn.id);
    assert.equal((await db.query("SELECT quantidade FROM estoque WHERE produto_id=$1",[product])).rows[0].quantidade,12);
    assert.equal((await db.query("SELECT status FROM devolucoes WHERE id=$1",[routeReturn.id])).rows[0].status,"CONCLUIDA");
};
