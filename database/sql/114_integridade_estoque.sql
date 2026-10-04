-- Reservas não podem ser contornadas por ajustes administrativos.
CREATE OR REPLACE FUNCTION proteger_estoque_reservado() RETURNS TRIGGER AS $$
DECLARE reservado BIGINT;
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Preserve o histórico de estoque; ajuste a quantidade.' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM produtos WHERE id=NEW.produto_id AND empresa_id=NEW.empresa_id) THEN
        RAISE EXCEPTION 'Produto pertence a outra empresa.' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(SUM(quantidade),0) INTO reservado FROM reservas_estoque
    WHERE empresa_id=NEW.empresa_id AND produto_id=NEW.produto_id AND confirmada_em IS NULL AND liberada_em IS NULL;
    IF NEW.quantidade<reservado THEN
        RAISE EXCEPTION 'Quantidade inferior ao estoque reservado.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_proteger_estoque BEFORE INSERT OR UPDATE OR DELETE ON estoque
FOR EACH ROW EXECUTE FUNCTION proteger_estoque_reservado();

CREATE OR REPLACE FUNCTION registrar_movimentacao_estoque() RETURNS TRIGGER AS $$
DECLARE anterior INTEGER; delta INTEGER;
BEGIN
    anterior := CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.quantidade END;
    delta := NEW.quantidade-anterior;
    IF delta<>0 THEN
        INSERT INTO movimentacoes_estoque(empresa_id,produto_id,tipo,quantidade,saldo_anterior,saldo_novo,referencia_tipo,referencia_id,usuario_id,observacao)
        VALUES(NEW.empresa_id,NEW.produto_id,CASE WHEN delta>0 THEN 'ENTRADA' ELSE 'SAIDA' END,ABS(delta),anterior,NEW.quantidade,
            NULLIF(current_setting('petflow.referencia_tipo',TRUE),''),
            NULLIF(current_setting('petflow.referencia_id',TRUE),'')::uuid,
            NULLIF(current_setting('petflow.usuario_id',TRUE),'')::uuid,'Alteração transacional de estoque');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_movimentacao_saldo AFTER INSERT OR UPDATE ON estoque
FOR EACH ROW EXECUTE FUNCTION registrar_movimentacao_estoque();
