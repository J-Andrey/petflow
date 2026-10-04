ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_frete NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_frete >= 0);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS distancia_entrega_m INTEGER CHECK (distancia_entrega_m >= 0);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS endereco_entrega JSONB;

-- O PetFlow original possui este gatilho desde a migração 099. Ele precisa
-- considerar o frete antes de ativarmos a nova restrição de total.
CREATE OR REPLACE FUNCTION sync_vendas_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.desconto := COALESCE(NEW.desconto, 0);
    NEW.acrescimo := COALESCE(NEW.acrescimo, 0);
    NEW.valor_total := COALESCE(NEW.valor_total, 0);
    NEW.valor_frete := COALESCE(NEW.valor_frete, 0);
    NEW.valor_final := NEW.valor_total - NEW.desconto + NEW.acrescimo + NEW.valor_frete;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_vendas_total ON vendas;
CREATE TRIGGER trg_sync_vendas_total
BEFORE INSERT OR UPDATE ON vendas
FOR EACH ROW EXECUTE FUNCTION sync_vendas_total();

ALTER TABLE vendas DROP CONSTRAINT IF EXISTS chk_vendas_calculo;
ALTER TABLE vendas ADD CONSTRAINT chk_vendas_calculo
    CHECK (valor_final = valor_total - desconto + acrescimo + valor_frete);

CREATE TABLE IF NOT EXISTS entrega_rastreamento (
    venda_id UUID PRIMARY KEY REFERENCES vendas(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expira_em TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    precisao_m DOUBLE PRECISION CHECK (precisao_m >= 0),
    atualizado_em TIMESTAMPTZ
);

-- Revoga o acesso e remove a posição assim que o pedido deixa a etapa de entrega.
CREATE OR REPLACE FUNCTION encerrar_rastreamento_entrega() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status <> 'SAIU_PARA_ENTREGA' AND OLD.status = 'SAIU_PARA_ENTREGA' THEN
        DELETE FROM entrega_rastreamento WHERE venda_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_encerrar_rastreamento ON vendas;
CREATE TRIGGER trg_encerrar_rastreamento AFTER UPDATE ON vendas
FOR EACH ROW EXECUTE FUNCTION encerrar_rastreamento_entrega();
