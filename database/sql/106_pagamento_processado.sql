-- Marca persistente para webhooks repetidos, inclusive depois da entrega/cancelamento.
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS estoque_baixado_em TIMESTAMPTZ;
UPDATE vendas v SET estoque_baixado_em = COALESCE(v.pagamento_atualizado_em, v.updated_at, NOW())
WHERE v.estoque_baixado_em IS NULL AND (
    v.status IN ('PAGAMENTO_APROVADO', 'EM_SEPARACAO', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'FINALIZADA')
    OR EXISTS (SELECT 1 FROM financeiro f WHERE f.origem = 'VENDA' AND f.referencia_id = v.id AND f.empresa_id = v.empresa_id)
);
