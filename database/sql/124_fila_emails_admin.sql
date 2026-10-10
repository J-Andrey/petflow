-- O legado sem empresa comprovada permanece fora da administração por empresa.
ALTER TABLE fila_emails
    ADD COLUMN empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    ADD COLUMN tratada_em TIMESTAMPTZ,
    ADD COLUMN tratada_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE INDEX idx_fila_emails_empresa_criacao ON fila_emails(empresa_id,criada_em DESC,id);
CREATE INDEX idx_fila_emails_empresa_pendencias ON fila_emails(empresa_id,status)
    WHERE tratada_em IS NULL AND status IN ('FALHA','INCERTA');
