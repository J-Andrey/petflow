-- Só rejeições comprovadas permitem tentar novamente o mesmo pedido.
-- Tentativas INCERTAS antigas não são liberadas sem conferência no provedor.
ALTER TABLE checkout_tentativas DROP CONSTRAINT checkout_tentativas_status_check;
ALTER TABLE checkout_tentativas ADD CONSTRAINT checkout_tentativas_status_check
    CHECK(status IN ('INICIADA','CONCLUIDA','INCERTA','REJEITADA'));
ALTER TABLE checkout_tentativas ADD COLUMN codigo_erro VARCHAR(80);
