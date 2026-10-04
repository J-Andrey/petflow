ALTER TABLE agendamentos ADD COLUMN duracao_minutos INTEGER NOT NULL DEFAULT 30 CHECK(duracao_minutos>0 AND duracao_minutos<=1440);
ALTER TABLE agendamentos ADD COLUMN cancelamento_motivo VARCHAR(500);
ALTER TABLE agendamentos ADD COLUMN alterado_por UUID REFERENCES usuarios(id);
UPDATE agendamentos a SET duracao_minutos=LEAST(1440,GREATEST(1,s.duracao)) FROM servicos s WHERE s.id=a.servico_id AND s.duracao IS NOT NULL;
ALTER TABLE consultas ADD COLUMN empresa_id UUID REFERENCES empresas(id);
UPDATE consultas c SET empresa_id=p.empresa_id FROM pets p WHERE p.id=c.pet_id;
ALTER TABLE prontuarios ADD COLUMN empresa_id UUID REFERENCES empresas(id);
UPDATE prontuarios p SET empresa_id=c.empresa_id FROM consultas c WHERE c.id=p.consulta_id;
ALTER TABLE vacinas ADD COLUMN empresa_id UUID REFERENCES empresas(id) DEFAULT get_petflow_empresa_id();
UPDATE vacinas SET empresa_id=get_petflow_empresa_id() WHERE empresa_id IS NULL;
ALTER TABLE vacinas DROP CONSTRAINT IF EXISTS vacinas_nome_key;
CREATE UNIQUE INDEX uq_vacina_empresa_nome ON vacinas(empresa_id,LOWER(nome));
ALTER TABLE historico_vacinas ADD COLUMN empresa_id UUID REFERENCES empresas(id);
UPDATE historico_vacinas h SET empresa_id=p.empresa_id FROM pets p WHERE p.id=h.pet_id;
CREATE INDEX idx_consultas_empresa ON consultas(empresa_id,data_consulta);
CREATE INDEX idx_prontuarios_empresa ON prontuarios(empresa_id);
CREATE INDEX idx_vacinas_empresa ON vacinas(empresa_id);
CREATE INDEX idx_historico_vacinas_empresa ON historico_vacinas(empresa_id,proxima_dose);
CREATE OR REPLACE FUNCTION preservar_historico_clinico() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Registros clínicos não podem ser apagados; registre uma correção auditada.' USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_preservar_consultas BEFORE DELETE ON consultas FOR EACH ROW EXECUTE FUNCTION preservar_historico_clinico();
CREATE TRIGGER trg_preservar_prontuarios BEFORE DELETE ON prontuarios FOR EACH ROW EXECUTE FUNCTION preservar_historico_clinico();
CREATE TRIGGER trg_preservar_vacinacao BEFORE DELETE ON historico_vacinas FOR EACH ROW EXECUTE FUNCTION preservar_historico_clinico();
