/*
 * Categoria solicitada pela loja para tartarugas, jabutis e outros répteis.
 * Preserva categorias existentes, inclusive nomes legados e inativações.
 * A normalização de E evita depender da extensão opcional unaccent.
 */
WITH loja AS (
    SELECT get_petflow_empresa_id() AS id
)
INSERT INTO categorias (empresa_id, nome, descricao, ativo, status)
SELECT loja.id,
       'Répteis',
       'Rações, alimentos e acessórios para tartarugas, jabutis e outros répteis.',
       TRUE,
       TRUE
FROM loja
WHERE NOT EXISTS (
    SELECT 1
    FROM categorias c
    WHERE c.empresa_id = loja.id
      AND LOWER(TRANSLATE(BTRIM(c.nome), 'éÉèÈêÊëË', 'eeeeeeee')) = 'repteis'
)
-- O nome ainda é único globalmente no schema legado: não apropriar uma
-- categoria de outra empresa nem alterar seus dados para resolver colisões.
ON CONFLICT (nome) DO NOTHING;
