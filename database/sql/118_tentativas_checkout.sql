-- Uma tentativa durável impede recriar checkout após timeout ou falha de gravação.
CREATE TABLE checkout_tentativas (
    venda_id UUID PRIMARY KEY REFERENCES vendas(id),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    chave_idempotencia VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'INICIADA' CHECK(status IN ('INICIADA','CONCLUIDA','INCERTA')),
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_checkout_tentativas_status ON checkout_tentativas(empresa_id,status);
