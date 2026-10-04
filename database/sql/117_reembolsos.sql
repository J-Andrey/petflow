CREATE TABLE reembolsos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    venda_id UUID NOT NULL UNIQUE REFERENCES vendas(id),
    chave_idempotencia VARCHAR(100) NOT NULL UNIQUE,
    valor_centavos BIGINT NOT NULL CHECK(valor_centavos>0),
    status VARCHAR(20) NOT NULL DEFAULT 'SOLICITADO' CHECK(status IN ('SOLICITADO','PROCESSANDO','INCERTO','CONCLUIDO')),
    motivo VARCHAR(500) NOT NULL,
    solicitado_por UUID REFERENCES usuarios(id),
    provedor_id VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
