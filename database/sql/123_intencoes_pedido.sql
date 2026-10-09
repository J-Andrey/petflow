-- A intenção e o pedido são gravados na mesma transação. Reenvios da mesma
-- intenção não criam outra reserva nem outro e-mail de pedido recebido.
CREATE UNIQUE INDEX uq_vendas_empresa_id ON vendas(empresa_id,id);
CREATE TABLE pedido_intencoes (
    empresa_id UUID NOT NULL,
    cliente_id UUID NOT NULL,
    chave UUID NOT NULL,
    fingerprint CHAR(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    venda_id UUID NOT NULL UNIQUE,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (empresa_id,cliente_id,chave),
    FOREIGN KEY (empresa_id,cliente_id) REFERENCES clientes(empresa_id,id) ON DELETE CASCADE,
    FOREIGN KEY (empresa_id,venda_id) REFERENCES vendas(empresa_id,id)
);
