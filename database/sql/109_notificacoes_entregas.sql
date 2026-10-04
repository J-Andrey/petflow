-- Executado novamente a cada deploy: não recria avisos já enviados.
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS venda_id UUID REFERENCES vendas(id) ON DELETE CASCADE;
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS status_pedido VARCHAR(30);

CREATE TABLE IF NOT EXISTS notificacoes_admin (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
    venda_id UUID REFERENCES vendas(id) ON DELETE CASCADE,
    titulo VARCHAR(150) NOT NULL,
    mensagem TEXT NOT NULL,
    enviada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notificacoes_admin_empresa ON notificacoes_admin(empresa_id, enviada_em DESC);
CREATE TABLE IF NOT EXISTS notificacoes_admin_leituras (
    notificacao_id UUID NOT NULL REFERENCES notificacoes_admin(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    lida_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notificacao_id, usuario_id)
);

CREATE OR REPLACE FUNCTION notificar_cadastro_cliente() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notificacoes_admin (empresa_id, cliente_id, titulo, mensagem)
    SELECT c.empresa_id, c.id, 'Novo cliente cadastrado', c.nome || ' criou uma conta na loja.'
    FROM clientes c WHERE c.id = NEW.cliente_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_notificar_cadastro ON usuarios_clientes;
CREATE TRIGGER trg_notificar_cadastro AFTER INSERT ON usuarios_clientes
FOR EACH ROW EXECUTE FUNCTION notificar_cadastro_cliente();

CREATE OR REPLACE FUNCTION notificar_status_pedido() RETURNS TRIGGER AS $$
DECLARE rotulo TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
        INSERT INTO notificacoes_admin (empresa_id, venda_id, titulo, mensagem)
        VALUES (NEW.empresa_id, NEW.id, 'Novo pedido recebido', 'Pedido #' || UPPER(LEFT(NEW.id::text,8)) || ' recebido. Acompanhe o pagamento e a entrega.');
    END IF;
    rotulo := CASE NEW.status
        WHEN 'AGUARDANDO_PAGAMENTO' THEN 'Aguardando pagamento'
        WHEN 'PAGAMENTO_APROVADO' THEN 'Pagamento aprovado'
        WHEN 'EM_SEPARACAO' THEN 'Preparando seu pedido'
        WHEN 'SAIU_PARA_ENTREGA' THEN 'Seu pedido saiu para entrega'
        WHEN 'ENTREGUE' THEN 'Pedido entregue'
        WHEN 'FINALIZADA' THEN 'Pedido finalizado'
        WHEN 'CANCELADA' THEN 'Pedido cancelado'
        ELSE 'Pedido atualizado' END;
    IF NEW.cliente_id IS NOT NULL THEN
        INSERT INTO notificacoes (cliente_id, venda_id, status_pedido, titulo, mensagem, tipo)
        VALUES (NEW.cliente_id, NEW.id, NEW.status, rotulo,
            'Pedido #' || UPPER(LEFT(NEW.id::text,8)) || ': ' || rotulo || '.' ||
            CASE WHEN NEW.status = 'SAIU_PARA_ENTREGA' THEN ' Acompanhe o entregador e prepare-se para receber a entrega.' ELSE '' END,
            'SISTEMA');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_notificar_status_pedido ON vendas;
CREATE TRIGGER trg_notificar_status_pedido AFTER INSERT OR UPDATE ON vendas
FOR EACH ROW EXECUTE FUNCTION notificar_status_pedido();

ALTER TABLE entrega_rastreamento ADD COLUMN IF NOT EXISTS rota JSONB;
ALTER TABLE entrega_rastreamento ADD COLUMN IF NOT EXISTS rota_solicitada_em TIMESTAMPTZ;
