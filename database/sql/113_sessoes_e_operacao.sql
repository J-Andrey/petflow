-- Migração aditiva: preserva módulos e histórico existentes.
CREATE OR REPLACE FUNCTION revogar_sessoes_conta() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.senha_hash IS DISTINCT FROM OLD.senha_hash OR NEW.ativo IS DISTINCT FROM OLD.ativo
       OR (TG_TABLE_NAME = 'usuarios' AND (to_jsonb(NEW)->>'perfil' IS DISTINCT FROM to_jsonb(OLD)->>'perfil'))
       OR (to_jsonb(NEW)->>'empresa_id' IS DISTINCT FROM to_jsonb(OLD)->>'empresa_id') THEN
        NEW.sessao_versao := GREATEST(NEW.sessao_versao, OLD.sessao_versao + 1);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_revogar_sessoes_admin BEFORE UPDATE ON usuarios
FOR EACH ROW EXECUTE FUNCTION revogar_sessoes_conta();
CREATE TRIGGER trg_revogar_sessoes_cliente BEFORE UPDATE ON usuarios_clientes
FOR EACH ROW EXECUTE FUNCTION revogar_sessoes_conta();

CREATE OR REPLACE FUNCTION revogar_sessoes_perfil_cliente() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ativo IS DISTINCT FROM OLD.ativo OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.anonimizado_em IS DISTINCT FROM OLD.anonimizado_em THEN
        UPDATE usuarios_clientes SET sessao_versao=sessao_versao+1 WHERE cliente_id=NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_revogar_sessoes_perfil_cliente AFTER UPDATE ON clientes
FOR EACH ROW EXECUTE FUNCTION revogar_sessoes_perfil_cliente();

-- Links legados em texto puro são invalidados. Usar reenvio/recuperação após o deploy.
UPDATE usuarios SET token_recuperacao=NULL, token_expiracao=NULL;
UPDATE usuarios_clientes SET token_recuperacao=NULL, token_expiracao=NULL,
    token_verificacao_email=NULL, token_verificacao_expiracao=NULL;

ALTER TABLE notificacoes ADD COLUMN chave_evento VARCHAR(200);
CREATE UNIQUE INDEX uq_notificacoes_evento ON notificacoes (cliente_id, chave_evento) WHERE chave_evento IS NOT NULL;
CREATE TABLE historico_pedidos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    venda_id UUID NOT NULL REFERENCES vendas(id),
    status_anterior VARCHAR(30), status_novo VARCHAR(30) NOT NULL,
    usuario_id UUID REFERENCES usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION registrar_historico_pedido() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO historico_pedidos(empresa_id,venda_id,status_anterior,status_novo)
        VALUES(NEW.empresa_id,NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.status ELSE NULL END,NEW.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_historico_pedido AFTER INSERT OR UPDATE ON vendas
FOR EACH ROW EXECUTE FUNCTION registrar_historico_pedido();
