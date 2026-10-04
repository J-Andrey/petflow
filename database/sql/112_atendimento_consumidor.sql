/* Atendimento eletrônico, cancelamento e arrependimento do consumidor. */

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE usuarios_clientes ADD COLUMN IF NOT EXISTS sessao_versao INTEGER NOT NULL DEFAULT 1;

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS entregue_em TIMESTAMPTZ;
UPDATE vendas SET entregue_em = COALESCE(entregue_em, updated_at, data_venda)
WHERE status IN ('ENTREGUE','FINALIZADA') AND entregue_em IS NULL;

CREATE OR REPLACE FUNCTION registrar_data_entrega() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'ENTREGUE' AND OLD.status IS DISTINCT FROM 'ENTREGUE' THEN
        NEW.entregue_em := COALESCE(NEW.entregue_em, NOW());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_registrar_data_entrega ON vendas;
CREATE TRIGGER trg_registrar_data_entrega
BEFORE UPDATE ON vendas
FOR EACH ROW EXECUTE FUNCTION registrar_data_entrega();

CREATE TABLE IF NOT EXISTS solicitacoes_consumidor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocolo VARCHAR(32) NOT NULL UNIQUE,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    venda_id UUID NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    email_referencia VARCHAR(150),
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('CANCELAMENTO','ARREPENDIMENTO','DEVOLUCAO','RECLAMACAO')),
    status VARCHAR(20) NOT NULL DEFAULT 'RECEBIDA' CHECK (status IN ('RECEBIDA','EM_ANALISE','ATENDIDA','NEGADA')),
    motivo VARCHAR(1000) NOT NULL,
    resposta VARCHAR(2000),
    solicitada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    prazo_em TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 days'),
    atendida_em TIMESTAMPTZ,
    atendida_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_consumidor_empresa_status
ON solicitacoes_consumidor (empresa_id, status, solicitada_em DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitacao_consumidor_aberta
ON solicitacoes_consumidor (empresa_id, venda_id)
WHERE status IN ('RECEBIDA','EM_ANALISE');

CREATE OR REPLACE FUNCTION notificar_solicitacao_consumidor() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notificacoes_admin (empresa_id, cliente_id, venda_id, titulo, mensagem)
    VALUES (
        NEW.empresa_id,
        NEW.cliente_id,
        NEW.venda_id,
        'Nova solicitação de atendimento',
        'Protocolo ' || NEW.protocolo || ': ' || NEW.tipo || ' no pedido #' || UPPER(LEFT(NEW.venda_id::text, 8)) || '.'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notificar_solicitacao_consumidor ON solicitacoes_consumidor;
CREATE TRIGGER trg_notificar_solicitacao_consumidor
AFTER INSERT ON solicitacoes_consumidor
FOR EACH ROW EXECUTE FUNCTION notificar_solicitacao_consumidor();
