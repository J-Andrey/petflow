/*
==========================================================
 PETFLOW
 Arquivo: 110_admin_profissional.sql
 Descricao: reservas, cancelamentos, auditoria e administracao.
==========================================================
*/

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS reserva_expira_em TIMESTAMPTZ;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS estoque_devolvido_em TIMESTAMPTZ;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cancelado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cancelamento_motivo VARCHAR(500);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS reembolso_status VARCHAR(30);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS reembolso_id VARCHAR(120);

CREATE TABLE IF NOT EXISTS reservas_estoque (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    venda_id UUID NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    expira_em TIMESTAMPTZ NOT NULL,
    confirmada_em TIMESTAMPTZ,
    liberada_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (venda_id, produto_id),
    CHECK (NOT (confirmada_em IS NOT NULL AND liberada_em IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_reservas_estoque_ativas
ON reservas_estoque (empresa_id, expira_em)
WHERE confirmada_em IS NULL AND liberada_em IS NULL;

ALTER TABLE compras ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS cancelado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(500);

ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS referencia_tipo VARCHAR(30);
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS referencia_id UUID;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS saldo_anterior INTEGER;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS saldo_novo INTEGER;
UPDATE movimentacoes_estoque m
SET empresa_id = p.empresa_id
FROM produtos p
WHERE m.produto_id = p.id AND m.empresa_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_movimentacoes_empresa_data
ON movimentacoes_estoque (empresa_id, data_movimentacao DESC);

ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS criado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE cupons ADD COLUMN IF NOT EXISTS limite_usos INTEGER CHECK (limite_usos IS NULL OR limite_usos > 0);
ALTER TABLE cupons ADD COLUMN IF NOT EXISTS limite_por_cliente INTEGER CHECK (limite_por_cliente IS NULL OR limite_por_cliente > 0);
ALTER TABLE cupons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS auditoria_admin (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    acao VARCHAR(40) NOT NULL,
    entidade VARCHAR(60) NOT NULL,
    entidade_id VARCHAR(120),
    descricao VARCHAR(500) NOT NULL,
    dados_anteriores JSONB,
    dados_novos JSONB,
    ip VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_empresa_data
ON auditoria_admin (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidade
ON auditoria_admin (empresa_id, entidade, entidade_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    nome VARCHAR(255) PRIMARY KEY,
    checksum VARCHAR(64) NOT NULL,
    aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

