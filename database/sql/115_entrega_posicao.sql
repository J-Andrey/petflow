ALTER TABLE entrega_rastreamento ADD COLUMN observado_em TIMESTAMPTZ;
ALTER TABLE entrega_rastreamento ADD COLUMN direcao DOUBLE PRECISION CHECK (direcao>=0 AND direcao<360);
ALTER TABLE entrega_rastreamento ADD COLUMN velocidade DOUBLE PRECISION CHECK (velocidade>=0);
