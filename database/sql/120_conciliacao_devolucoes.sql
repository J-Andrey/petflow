/* Totais monetários em centavos e evidência mínima de consultas ao provedor.
   Receitas originais são preservadas; saídas/créditos têm lançamentos próprios. */
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS estornado_centavos BIGINT NOT NULL DEFAULT 0 CHECK(estornado_centavos>=0);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS conciliacao_status VARCHAR(20) NOT NULL DEFAULT 'SEM_PENDENCIA'
    CHECK(conciliacao_status IN ('SEM_PENDENCIA','PENDENTE','EM_ANALISE','CONCILIADO'));
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS conciliacao_resposta VARCHAR(2000);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS conciliada_por UUID REFERENCES usuarios(id);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS conciliada_em TIMESTAMPTZ;
-- Reembolsos antigos já tiveram seu efeito financeiro no fluxo anterior.
UPDATE vendas v SET estornado_centavos=r.valor_centavos
FROM reembolsos r WHERE r.venda_id=v.id AND r.empresa_id=v.empresa_id AND r.status='CONCLUIDO';

CREATE TABLE conciliacao_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    venda_id UUID NOT NULL REFERENCES vendas(id),
    tipo VARCHAR(30) NOT NULL CHECK(tipo IN ('ESTORNO','CHARGEBACK','REVERSAO_CHARGEBACK','CONSULTA')),
    provedor_id VARCHAR(120) NOT NULL,
    chave_evidencia VARCHAR(64) NOT NULL UNIQUE,
    valor_centavos BIGINT NOT NULL CHECK(valor_centavos>=0),
    evidencia JSONB NOT NULL,
    financeiro_id UUID REFERENCES financeiro(id),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conciliacao_eventos_venda ON conciliacao_eventos(empresa_id,venda_id,criado_em DESC);
CREATE UNIQUE INDEX uq_financeiro_conciliacao ON financeiro(empresa_id,origem,referencia_id)
    WHERE origem IN ('ESTORNO','CHARGEBACK','REVERSAO_CHARGEBACK');

CREATE TABLE disputas_pagamento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    venda_id UUID NOT NULL REFERENCES vendas(id),
    provedor_id VARCHAR(120) NOT NULL UNIQUE,
    status_provedor VARCHAR(50) NOT NULL,
    valor_centavos BIGINT NOT NULL CHECK(valor_centavos>0),
    perda_centavos BIGINT NOT NULL DEFAULT 0 CHECK(perda_centavos>=0),
    atualizado_provedor_em TIMESTAMPTZ NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(perda_centavos<=valor_centavos)
);
CREATE INDEX idx_disputas_empresa_venda ON disputas_pagamento(empresa_id,venda_id);

CREATE TABLE devolucoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    venda_id UUID NOT NULL REFERENCES vendas(id),
    solicitacao_id UUID NOT NULL UNIQUE REFERENCES solicitacoes_consumidor(id),
    status VARCHAR(30) NOT NULL DEFAULT 'APROVADA' CHECK(status IN ('APROVADA','RECEBIDA','REEMBOLSO_SOLICITADO','CONCLUIDA')),
    valor_centavos BIGINT NOT NULL CHECK(valor_centavos>=0),
    motivo VARCHAR(500) NOT NULL,
    aprovada_por UUID NOT NULL REFERENCES usuarios(id),
    aprovada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recebida_por UUID REFERENCES usuarios(id),
    recebida_em TIMESTAMPTZ,
    recebimento_observacao VARCHAR(1000),
    concluida_em TIMESTAMPTZ,
    CHECK((recebida_em IS NULL)=(recebida_por IS NULL))
);
CREATE TABLE devolucao_itens (
    devolucao_id UUID NOT NULL REFERENCES devolucoes(id),
    produto_id UUID NOT NULL REFERENCES produtos(id),
    quantidade INTEGER NOT NULL CHECK(quantidade>0),
    repor_estoque BOOLEAN,
    PRIMARY KEY(devolucao_id,produto_id)
);
CREATE INDEX idx_devolucoes_empresa_venda ON devolucoes(empresa_id,venda_id);
ALTER TABLE reembolsos DROP CONSTRAINT reembolsos_venda_id_key;
ALTER TABLE reembolsos ADD COLUMN finalidade VARCHAR(20) NOT NULL DEFAULT 'CANCELAMENTO'
    CHECK(finalidade IN ('CANCELAMENTO','DEVOLUCAO'));
ALTER TABLE reembolsos ADD COLUMN devolucao_id UUID UNIQUE REFERENCES devolucoes(id);
ALTER TABLE reembolsos ADD COLUMN base_estornada_centavos BIGINT NOT NULL DEFAULT 0 CHECK(base_estornada_centavos>=0);
ALTER TABLE reembolsos ADD COLUMN tentativa_em TIMESTAMPTZ;
-- Intenções antigas não têm prova de que o POST nunca saiu. Somente consultar.
UPDATE reembolsos SET status='INCERTO',updated_at=NOW() WHERE status='SOLICITADO';
UPDATE vendas v SET reembolso_status='INCERTO' FROM reembolsos r
    WHERE r.venda_id=v.id AND r.empresa_id=v.empresa_id AND r.status='INCERTO';
CREATE UNIQUE INDEX uq_reembolso_cancelamento ON reembolsos(empresa_id,venda_id) WHERE finalidade='CANCELAMENTO';
CREATE UNIQUE INDEX uq_reembolso_em_andamento ON reembolsos(empresa_id,venda_id) WHERE status<>'CONCLUIDO';
