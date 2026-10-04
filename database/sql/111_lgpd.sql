/* Direitos do titular, consentimentos e solicitações LGPD. */

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS privacidade_versao VARCHAR(30);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS privacidade_aceita_em TIMESTAMPTZ;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS anonimizado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS lgpd_consentimentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    finalidade VARCHAR(60) NOT NULL,
    versao VARCHAR(30) NOT NULL,
    concedido BOOLEAN NOT NULL,
    origem VARCHAR(40) NOT NULL DEFAULT 'SITE',
    ip_hash VARCHAR(64),
    user_agent_hash VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lgpd_consentimentos_cliente
ON lgpd_consentimentos (empresa_id, cliente_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lgpd_solicitacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocolo VARCHAR(32) NOT NULL UNIQUE,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    email_referencia VARCHAR(150),
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('ACESSO','CORRECAO','ANONIMIZACAO','EXCLUSAO','PORTABILIDADE','REVOGACAO','INFORMACAO')),
    status VARCHAR(20) NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA','EM_ANALISE','ATENDIDA','NEGADA')),
    detalhes VARCHAR(1000),
    resposta VARCHAR(2000),
    solicitada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    prazo_em TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 days'),
    atendida_em TIMESTAMPTZ,
    atendida_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lgpd_solicitacoes_empresa_status
ON lgpd_solicitacoes (empresa_id, status, solicitada_em DESC);

CREATE OR REPLACE FUNCTION notificar_solicitacao_lgpd() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notificacoes_admin (empresa_id, cliente_id, titulo, mensagem)
    VALUES (
        NEW.empresa_id,
        NEW.cliente_id,
        'Nova solicitação LGPD',
        'Protocolo ' || NEW.protocolo || ': ' || NEW.tipo || '. Prazo interno: ' || TO_CHAR(NEW.prazo_em, 'DD/MM/YYYY') || '.'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notificar_solicitacao_lgpd ON lgpd_solicitacoes;
CREATE TRIGGER trg_notificar_solicitacao_lgpd
AFTER INSERT ON lgpd_solicitacoes
FOR EACH ROW EXECUTE FUNCTION notificar_solicitacao_lgpd();
