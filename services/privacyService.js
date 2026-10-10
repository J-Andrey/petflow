"use strict";
const audit = require("./auditService");
const { enqueueEmail } = require("./emailQueueService");

// Colunas explícitas impedem que novos campos internos entrem na exportação.
// Também filtramos o resultado: JSON legado (como endereço) nunca é copiado inteiro.
function project(row, fields) {
  if (!row) return null;
  return Object.fromEntries(
    fields
      .split(",")
      .map((field) => field.trim())
      .filter(
        (field) =>
          Object.hasOwn(row, field) &&
          (row[field] === null ||
            ["string", "number", "boolean"].includes(typeof row[field]) ||
            row[field] instanceof Date),
      )
      .map((field) => [field, row[field]]),
  );
}

async function exportCustomerData(db, customer) {
  return db.transaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const params = [customer.id, customer.empresaId];
    async function rows(fields, source) {
      const result = await client.query(`SELECT ${fields} ${source}`, params);
      const names = fields
        .replace(/^DISTINCT\s+/, "")
        .split(",")
        .map((field) =>
          field
            .trim()
            .split(/\s+AS\s+/i)
            .pop()
            .replace(/^\w+\./, ""),
        )
        .join(",");
      return result.rows.map((row) => project(row, names));
    }
    const profileFields =
      "id,nome,cpf,data_nascimento,telefone,whatsapp,email,cep,endereco,numero,complemento,bairro,cidade,estado,observacoes,ativo,privacidade_versao,privacidade_aceita_em,anonimizado_em,created_at,updated_at";
    const profile = await rows(
      profileFields,
      "FROM clientes WHERE id=$1 AND empresa_id=$2",
    );
    if (!profile.length)
      throw Object.assign(new Error("Titular não encontrado."), {
        status: 404,
      });
    const data = { perfil: profile[0] };
    data.conta =
      (
        await rows(
          "u.email,u.email_verificado,u.ultimo_login,u.ativo,u.created_at,u.updated_at",
          "FROM usuarios_clientes u JOIN clientes c ON c.id=u.cliente_id WHERE c.id=$1 AND c.empresa_id=$2",
        )
      )[0] || null;
    data.pets = await rows(
      "id,nome,especie,raca,sexo,data_nascimento,idade,peso,cor,porte,castrado,microchip,alergias,observacoes,foto,ativo,created_at,updated_at",
      "FROM pets WHERE cliente_id=$1 AND empresa_id=$2 ORDER BY created_at,id",
    );
    data.agendamentos = await rows(
      "a.id,a.pet_id,s.id AS servico_id,a.servico,s.nome AS servico_nome,a.data_agendamento,a.horario,a.duracao_minutos,a.valor,a.status,a.observacoes,a.cancelamento_motivo,a.created_at,a.updated_at",
      "FROM agendamentos a JOIN pets p ON p.id=a.pet_id AND p.empresa_id=a.empresa_id AND p.cliente_id=a.cliente_id LEFT JOIN servicos s ON s.id=a.servico_id AND s.empresa_id=a.empresa_id WHERE a.cliente_id=$1 AND a.empresa_id=$2 ORDER BY a.data_agendamento,a.horario,a.id",
    );
    data.consultas = await rows(
      "c.id,c.pet_id,c.data_consulta,c.horario,c.peso,c.temperatura,c.motivo_consulta,c.status,c.observacoes,c.created_at,c.updated_at",
      "FROM consultas c JOIN pets p ON p.id=c.pet_id AND p.empresa_id=c.empresa_id AND p.cliente_id=c.cliente_id WHERE c.cliente_id=$1 AND c.empresa_id=$2 ORDER BY c.data_consulta,c.horario,c.id",
    );
    data.prontuarios = await rows(
      "r.id,r.consulta_id,r.diagnostico,r.tratamento,r.medicamentos,r.receita,r.exames_solicitados,r.observacoes,r.retorno,r.created_at,r.updated_at",
      "FROM prontuarios r JOIN consultas c ON c.id=r.consulta_id AND c.empresa_id=r.empresa_id JOIN pets p ON p.id=c.pet_id AND p.empresa_id=c.empresa_id AND p.cliente_id=c.cliente_id WHERE c.cliente_id=$1 AND r.empresa_id=$2 ORDER BY r.created_at,r.id",
    );
    data.vacinacoes = await rows(
      "h.id,h.pet_id,h.data_aplicacao,h.proxima_dose,h.lote,h.fabricante,h.observacoes,h.created_at,h.updated_at",
      "FROM historico_vacinas h JOIN pets p ON p.id=h.pet_id AND p.empresa_id=h.empresa_id WHERE p.cliente_id=$1 AND h.empresa_id=$2 ORDER BY h.data_aplicacao,h.id",
    );
    // O catálogo tem só os nomes das vacinas ligadas aos registros deste titular.
    data.vacinas = await rows(
      "DISTINCT v.id,v.nome,v.fabricante,v.descricao,v.intervalo_dias",
      "FROM vacinas v JOIN historico_vacinas h ON h.vacina_id=v.id AND h.empresa_id=v.empresa_id JOIN pets p ON p.id=h.pet_id AND p.empresa_id=h.empresa_id WHERE p.cliente_id=$1 AND h.empresa_id=$2 ORDER BY v.nome,v.id",
    );
    // Inclui apenas vínculos válidos com consultas do mesmo pet e titular.
    const vaccineLinks = await client.query(
      `SELECT h.id,v.id AS vacina_id,c.id AS consulta_id FROM historico_vacinas h
      JOIN pets p ON p.id=h.pet_id AND p.empresa_id=h.empresa_id
      LEFT JOIN vacinas v ON v.id=h.vacina_id AND v.empresa_id=h.empresa_id
      LEFT JOIN consultas c ON c.id=h.consulta_id AND c.empresa_id=h.empresa_id AND c.pet_id=h.pet_id AND c.cliente_id=p.cliente_id
      WHERE p.cliente_id=$1 AND h.empresa_id=$2`,
      params,
    );
    const links = new Map(
      vaccineLinks.rows.map((row) => [
        row.id,
        project(row, "vacina_id,consulta_id"),
      ]),
    );
    data.vacinacoes = data.vacinacoes.map((row) => ({
      ...row,
      ...links.get(row.id),
    }));
    const orderFields =
      "id,data_venda,valor_total,desconto,acrescimo,valor_frete,valor_final,forma_pagamento,status,observacoes,cupom_codigo,distancia_entrega_m,entregue_em,cancelado_em,cancelamento_motivo,reembolso_status,pagseguro_status,pagamento_atualizado_em,estornado_centavos,conciliacao_status,conciliacao_resposta,conciliada_em,created_at,updated_at";
    const orders = await client.query(
      `SELECT ${orderFields},endereco_entrega FROM vendas WHERE cliente_id=$1 AND empresa_id=$2 ORDER BY data_venda,id`,
      params,
    );
    data.pedidos = orders.rows.map((row) => ({
      ...project(row, orderFields),
      endereco_entrega: project(
        row.endereco_entrega,
        "cep,endereco,numero,complemento,bairro,cidade,estado",
      ),
    }));
    data.itens_pedidos = await rows(
      "i.id,i.venda_id,i.quantidade,i.preco_unitario,i.desconto,i.subtotal,i.created_at,i.updated_at",
      "FROM itens_venda i JOIN vendas v ON v.id=i.venda_id AND v.empresa_id=i.empresa_id WHERE v.cliente_id=$1 AND i.empresa_id=$2 ORDER BY v.data_venda,i.id",
    );
    // O produto de outra empresa, se existir um vínculo legado inconsistente, não é exposto.
    const productLinks = await client.query(
      `SELECT i.id,p.id AS produto_id,p.nome AS produto FROM itens_venda i
      JOIN vendas v ON v.id=i.venda_id AND v.empresa_id=i.empresa_id
      LEFT JOIN produtos p ON p.id=i.produto_id AND p.empresa_id=i.empresa_id
      WHERE v.cliente_id=$1 AND i.empresa_id=$2`,
      params,
    );
    const products = new Map(
      productLinks.rows.map((row) => [
        row.id,
        project(row, "produto_id,produto"),
      ]),
    );
    data.itens_pedidos = data.itens_pedidos.map((row) => ({
      ...row,
      ...products.get(row.id),
    }));
    data.historico_pedidos = await rows(
      "h.id,h.venda_id,h.status_anterior,h.status_novo,h.created_at",
      "FROM historico_pedidos h JOIN vendas v ON v.id=h.venda_id AND v.empresa_id=h.empresa_id WHERE v.cliente_id=$1 AND h.empresa_id=$2 ORDER BY h.created_at,h.id",
    );
    data.reembolsos = await rows(
      "r.id,r.venda_id,d.id AS devolucao_id,r.valor_centavos,r.status,r.motivo,r.finalidade,r.base_estornada_centavos,r.created_at,r.updated_at",
      "FROM reembolsos r JOIN vendas v ON v.id=r.venda_id AND v.empresa_id=r.empresa_id LEFT JOIN devolucoes d ON d.id=r.devolucao_id AND d.empresa_id=r.empresa_id AND d.venda_id=r.venda_id WHERE v.cliente_id=$1 AND r.empresa_id=$2 ORDER BY r.created_at,r.id",
    );
    data.pagamentos = await rows(
      "f.id,v.id AS venda_id,f.referencia_id,f.tipo,f.origem,f.descricao,f.valor,f.valor_pago,f.data_vencimento,f.data_pagamento,f.status,f.observacoes,f.created_at,f.updated_at",
      "FROM financeiro f JOIN vendas v ON v.empresa_id=f.empresa_id AND ((f.origem='VENDA' AND v.id=f.referencia_id) OR EXISTS(SELECT 1 FROM conciliacao_eventos e WHERE e.id=f.referencia_id AND e.financeiro_id=f.id AND e.empresa_id=f.empresa_id AND e.venda_id=v.id AND f.origem IN ('ESTORNO','CHARGEBACK','REVERSAO_CHARGEBACK'))) WHERE v.cliente_id=$1 AND f.empresa_id=$2 ORDER BY f.created_at,f.id",
    );
    const eventFields = "id,venda_id,tipo,valor_centavos,criado_em";
    const events = await client.query(
      `SELECT e.id,e.venda_id,e.tipo,e.valor_centavos,e.criado_em,e.evidencia
      FROM conciliacao_eventos e JOIN vendas v ON v.id=e.venda_id AND v.empresa_id=e.empresa_id
      WHERE v.cliente_id=$1 AND e.empresa_id=$2 ORDER BY e.criado_em,e.id`,
      params,
    );
    data.conciliacoes = events.rows.map((row) => ({
      ...project(row, eventFields),
      evidencia: project(
        row.evidencia,
        "charge_id,status,total_centavos,pago_centavos,estornado_centavos,moeda,id,valor_centavos,referencia,atualizado_em",
      ),
    }));
    data.disputas_pagamento = await rows(
      "d.id,d.venda_id,d.status_provedor,d.valor_centavos,d.perda_centavos,d.atualizado_provedor_em,d.atualizado_em",
      "FROM disputas_pagamento d JOIN vendas v ON v.id=d.venda_id AND v.empresa_id=d.empresa_id WHERE v.cliente_id=$1 AND d.empresa_id=$2 ORDER BY d.atualizado_em,d.id",
    );
    data.devolucoes = await rows(
      "d.id,d.venda_id,d.solicitacao_id,d.status,d.valor_centavos,d.motivo,d.aprovada_em,d.recebida_em,d.recebimento_observacao,d.concluida_em",
      "FROM devolucoes d JOIN vendas v ON v.id=d.venda_id AND v.empresa_id=d.empresa_id JOIN solicitacoes_consumidor s ON s.id=d.solicitacao_id AND s.empresa_id=d.empresa_id AND s.venda_id=d.venda_id AND s.cliente_id=v.cliente_id WHERE v.cliente_id=$1 AND d.empresa_id=$2 ORDER BY d.aprovada_em,d.id",
    );
    data.itens_devolucoes = await rows(
      "i.devolucao_id,p.id AS produto_id,p.nome AS produto,i.quantidade,i.repor_estoque",
      "FROM devolucao_itens i JOIN devolucoes d ON d.id=i.devolucao_id JOIN vendas v ON v.id=d.venda_id AND v.empresa_id=d.empresa_id JOIN solicitacoes_consumidor s ON s.id=d.solicitacao_id AND s.empresa_id=d.empresa_id AND s.venda_id=d.venda_id AND s.cliente_id=v.cliente_id LEFT JOIN produtos p ON p.id=i.produto_id AND p.empresa_id=d.empresa_id WHERE v.cliente_id=$1 AND d.empresa_id=$2 ORDER BY i.devolucao_id,i.produto_id",
    );
    data.checkouts = await rows(
      "t.venda_id,t.status,t.criada_em,t.atualizada_em",
      "FROM checkout_tentativas t JOIN vendas v ON v.id=t.venda_id AND v.empresa_id=t.empresa_id WHERE v.cliente_id=$1 AND t.empresa_id=$2 ORDER BY t.criada_em,t.venda_id",
    );
    data.notificacoes = await rows(
      "n.id,n.venda_id,n.status_pedido,n.titulo,n.mensagem,n.tipo,n.lida,n.data_leitura,n.enviada_em,n.created_at,n.updated_at",
      "FROM notificacoes n JOIN clientes c ON c.id=n.cliente_id WHERE c.id=$1 AND c.empresa_id=$2 AND (n.venda_id IS NULL OR EXISTS (SELECT 1 FROM vendas v WHERE v.id=n.venda_id AND v.cliente_id=c.id AND v.empresa_id=c.empresa_id)) ORDER BY n.enviada_em,n.id",
    );
    data.consentimentos = await rows(
      "id,finalidade,versao,concedido,origem,created_at",
      "FROM lgpd_consentimentos WHERE cliente_id=$1 AND empresa_id=$2 ORDER BY created_at,id",
    );
    data.solicitacoes_lgpd = await rows(
      "id,protocolo,tipo,status,detalhes,resposta,solicitada_em,prazo_em,atendida_em,created_at,updated_at",
      "FROM lgpd_solicitacoes WHERE cliente_id=$1 AND empresa_id=$2 ORDER BY solicitada_em,id",
    );
    data.solicitacoes_atendimento = await rows(
      "s.id,s.protocolo,s.venda_id,s.tipo,s.status,s.motivo,s.resposta,s.solicitada_em,s.prazo_em,s.atendida_em,s.created_at,s.updated_at",
      "FROM solicitacoes_consumidor s JOIN vendas v ON v.id=s.venda_id AND v.empresa_id=s.empresa_id AND v.cliente_id=s.cliente_id WHERE s.cliente_id=$1 AND s.empresa_id=$2 ORDER BY s.solicitada_em,s.id",
    );
    data.newsletter = await rows(
      "n.nome,n.email,n.status,n.origem,n.consentimento,n.data_inscricao,n.data_cancelamento,n.created_at,n.updated_at",
      "FROM newsletter_inscritos n JOIN clientes c ON c.empresa_id=n.empresa_id AND LOWER(c.email)=LOWER(n.email) WHERE c.id=$1 AND n.empresa_id=$2 ORDER BY n.data_inscricao,n.id",
    );
    data.observacao =
      "Exportação dos registros vinculados ao titular nesta empresa. Credenciais, tokens, respostas brutas de provedores e posição do entregador são omitidos. Para revisão de vínculos inconsistentes ou cópias de documentos externos, use o atendimento de privacidade.";
    return data;
  });
}
async function processRequest(db, req, id) {
  return db.transaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM lgpd_solicitacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
      [id, req.user.empresaId],
    );
    const item = result.rows[0];
    const fail = (message) => {
      throw Object.assign(new Error(message), { status: 409 });
    };
    if (!item || !["ABERTA", "EM_ANALISE"].includes(item.status))
      fail("Solicitação indisponível.");
    if (!["EXCLUSAO", "ANONIMIZACAO", "REVOGACAO"].includes(item.tipo))
      fail("Responda este tipo de solicitação pelo atendimento.");
    if (req.body.confirmacao !== "PROCESSAR")
      fail("Confirme expressamente o processamento.");
    if (item.tipo === "REVOGACAO" && req.body.finalidade !== "NEWSLETTER")
      fail(
        "Informe a finalidade NEWSLETTER para revogar esse consentimento. Outras finalidades exigem análise e resposta específica.",
      );
    const customer = (
      await client.query(
        "SELECT * FROM clientes WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
        [item.cliente_id, req.user.empresaId],
      )
    ).rows[0];
    if (!customer) fail("Titular não encontrado.");
    if (item.tipo !== "REVOGACAO") {
      // Bloqueia novos registros filhos durante a verificação de retenção.
      await client.query(
        "SELECT id FROM pets WHERE cliente_id=$1 AND empresa_id=$2 FOR UPDATE",
        [customer.id, req.user.empresaId],
      );
      const records = await client.query(
        `SELECT EXISTS(SELECT 1 FROM vendas WHERE cliente_id=$1 AND empresa_id=$2)
                OR EXISTS(SELECT 1 FROM agendamentos a WHERE a.empresa_id=$2 AND (a.cliente_id=$1 OR EXISTS(SELECT 1 FROM pets p WHERE p.id=a.pet_id AND p.empresa_id=a.empresa_id AND p.cliente_id=$1)))
                OR EXISTS(SELECT 1 FROM consultas c WHERE c.empresa_id=$2 AND (c.cliente_id=$1 OR EXISTS(SELECT 1 FROM pets p WHERE p.id=c.pet_id AND p.empresa_id=c.empresa_id AND p.cliente_id=$1)))
                OR EXISTS(SELECT 1 FROM prontuarios r JOIN consultas c ON c.id=r.consulta_id AND c.empresa_id=r.empresa_id WHERE r.empresa_id=$2 AND (c.cliente_id=$1 OR EXISTS(SELECT 1 FROM pets p WHERE p.id=c.pet_id AND p.empresa_id=c.empresa_id AND p.cliente_id=$1)))
                OR EXISTS(SELECT 1 FROM historico_vacinas h JOIN pets p ON p.id=h.pet_id AND p.empresa_id=h.empresa_id WHERE p.cliente_id=$1 AND h.empresa_id=$2)
                OR EXISTS(SELECT 1 FROM solicitacoes_consumidor WHERE cliente_id=$1 AND empresa_id=$2) AS retention`,
        [customer.id, req.user.empresaId],
      );
      if (records.rows[0].retention)
        fail(
          "O titular possui histórico comercial, de agenda ou clínico. Registre a análise de retenção antes de qualquer anonimização; esta operação automática foi bloqueada.",
        );
      const anonymous = "anon-" + customer.id + "@invalid.example";
      await client.query(
        `UPDATE clientes SET nome='Titular anonimizado',cpf=NULL,data_nascimento=NULL,telefone='REMOVIDO',whatsapp=NULL,
                email=$1,cep=NULL,endereco=NULL,numero=NULL,complemento=NULL,bairro=NULL,cidade=NULL,estado=NULL,observacoes=NULL,
                ativo=FALSE,anonimizado_em=NOW() WHERE id=$2 AND empresa_id=$3`,
        [anonymous, customer.id, req.user.empresaId],
      );
      await client.query(
        "UPDATE usuarios_clientes SET email=$1,ativo=FALSE,sessao_versao=sessao_versao+1,token_recuperacao=NULL,token_expiracao=NULL,token_verificacao_email=NULL,token_verificacao_expiracao=NULL WHERE cliente_id=$2 AND EXISTS(SELECT 1 FROM clientes c WHERE c.id=cliente_id AND c.empresa_id=$3)",
        [anonymous, customer.id, req.user.empresaId],
      );
      await client.query(
        "UPDATE pets SET nome='Pet anonimizado',raca=NULL,data_nascimento=NULL,idade=NULL,peso=NULL,cor=NULL,microchip=NULL,alergias=NULL,observacoes=NULL,foto=NULL,ativo=FALSE,status=FALSE WHERE cliente_id=$1 AND empresa_id=$2",
        [customer.id, req.user.empresaId],
      );
      await client.query(
        "UPDATE lgpd_solicitacoes SET email_referencia=NULL WHERE cliente_id=$1 AND empresa_id=$2",
        [customer.id, req.user.empresaId],
      );
    }
    await client.query(
      "DELETE FROM newsletter_inscritos WHERE empresa_id=$1 AND LOWER(email)=LOWER($2)",
      [req.user.empresaId, customer.email],
    );
    await client.query(
      "INSERT INTO lgpd_consentimentos(empresa_id,cliente_id,finalidade,versao,concedido,origem) VALUES($1,$2,'NEWSLETTER',$3,FALSE,'ADMIN')",
      [
        req.user.empresaId,
        customer.id,
        process.env.PRIVACY_POLICY_VERSION || "2026-10-04",
      ],
    );
    const answer =
      item.tipo === "REVOGACAO"
        ? "Consentimento para newsletter revogado. Outros tratamentos seguem as bases aplicáveis; solicite informação para detalhamento."
        : "Dados cadastrais não sujeitos à retenção foram anonimizados e as sessões foram revogadas.";
    await client.query(
      "UPDATE lgpd_solicitacoes SET status='ATENDIDA',resposta=$1,atendida_em=NOW(),atendida_por=$2,updated_at=NOW() WHERE id=$3 AND empresa_id=$4",
      [answer, req.user.id, id, req.user.empresaId],
    );
    await client.query(
      "INSERT INTO notificacoes(cliente_id,titulo,mensagem,tipo) VALUES($1,$2,$3,'SISTEMA')",
      [customer.id, "Resposta ao protocolo " + item.protocolo, answer],
    );
    await audit.record(
      client,
      req,
      "PROCESSAR_LGPD",
      "lgpd_solicitacoes",
      id,
      null,
      { status: "ATENDIDA", protocolo: item.protocolo },
    );
    await enqueueEmail(
      {
        empresaId: req.user.empresaId,
        to: customer.email,
        subject: "PetFlow: protocolo " + item.protocolo,
        text: answer,
        idempotencyKey: "lgpd-" + id,
      },
      client,
    );
    return {
      protocolo: item.protocolo,
      resposta: answer,
      email: customer.email,
    };
  });
}
module.exports = { processRequest, exportCustomerData };
