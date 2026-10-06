-- Não reassocia dados legados: vínculos inconsistentes precisam de revisão.
-- NOT VALID preserva os registros antigos, mas verifica toda nova gravação.
CREATE UNIQUE INDEX uq_clientes_empresa_id ON clientes(empresa_id,id);
CREATE UNIQUE INDEX uq_categorias_empresa_id ON categorias(empresa_id,id);
CREATE UNIQUE INDEX uq_fornecedores_empresa_id ON fornecedores(empresa_id,id);
CREATE UNIQUE INDEX uq_produtos_empresa_id ON produtos(empresa_id,id);
ALTER TABLE pets ADD CONSTRAINT fk_pet_tutor_empresa
    FOREIGN KEY(empresa_id,cliente_id) REFERENCES clientes(empresa_id,id) NOT VALID;
ALTER TABLE produtos ADD CONSTRAINT fk_produto_categoria_empresa
    FOREIGN KEY(empresa_id,categoria_id) REFERENCES categorias(empresa_id,id) NOT VALID;
ALTER TABLE produtos ADD CONSTRAINT fk_produto_fornecedor_empresa
    FOREIGN KEY(empresa_id,fornecedor_id) REFERENCES fornecedores(empresa_id,id) NOT VALID;
ALTER TABLE estoque ADD CONSTRAINT fk_estoque_produto_empresa
    FOREIGN KEY(empresa_id,produto_id) REFERENCES produtos(empresa_id,id) NOT VALID;
