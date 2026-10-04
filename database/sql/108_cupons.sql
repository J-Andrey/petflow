CREATE TABLE IF NOT EXISTS cupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    codigo VARCHAR(40) NOT NULL CHECK (codigo ~ '^[A-Z0-9_-]{3,40}$'),
    descricao VARCHAR(200) NOT NULL DEFAULT '',
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('PERCENTUAL', 'FIXO')),
    valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
    minimo_compra NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (minimo_compra >= 0),
    desconto_maximo NUMERIC(12,2) CHECK (desconto_maximo > 0),
    inicia_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expira_em TIMESTAMPTZ,
    ativo BOOLEAN NOT NULL DEFAULT FALSE,
    publico BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (empresa_id, codigo),
    CHECK (tipo <> 'PERCENTUAL' OR valor <= 100),
    CHECK (expira_em IS NULL OR expira_em > inicia_em)
);

-- Snapshot: alterar ou remover uma campanha não altera um pedido existente.
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cupom_codigo VARCHAR(40);

-- Campanha solicitada pela loja. Reaplicar a migração preserva edições posteriores.
INSERT INTO cupons (empresa_id, codigo, descricao, tipo, valor, ativo, publico)
VALUES (get_petflow_empresa_id(), 'PETFLOW10', '10% de desconto nos produtos', 'PERCENTUAL', 10, TRUE, TRUE)
ON CONFLICT (empresa_id, codigo) DO NOTHING;
