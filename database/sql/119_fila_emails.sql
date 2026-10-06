-- Outbox transacional: somente o worker chama o provedor para e-mails opcionais.
CREATE TABLE fila_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chave_idempotencia VARCHAR(100) NOT NULL UNIQUE,
    dados JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
        CHECK(status IN ('PENDENTE','PROCESSANDO','ENVIADA','FALHA','INCERTA')),
    tentativas INTEGER NOT NULL DEFAULT 0 CHECK(tentativas >= 0),
    proxima_tentativa_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    primeira_tentativa_em TIMESTAMPTZ,
    bloqueada_ate TIMESTAMPTZ,
    token_bloqueio UUID,
    resultado_incerto BOOLEAN NOT NULL DEFAULT FALSE,
    provedor_id VARCHAR(100),
    erro_codigo VARCHAR(40),
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expira_em TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    CHECK((status = 'PROCESSANDO') = (token_bloqueio IS NOT NULL)),
    CHECK((status = 'PROCESSANDO') = (bloqueada_ate IS NOT NULL))
);
CREATE INDEX idx_fila_emails_pendentes ON fila_emails(proxima_tentativa_em, criada_em)
    WHERE status = 'PENDENTE';
CREATE INDEX idx_fila_emails_processando ON fila_emails(bloqueada_ate)
    WHERE status = 'PROCESSANDO';
