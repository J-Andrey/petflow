"use strict";
// Itens fazem parte da transação do pedido/compra, não de um CRUD independente.
module.exports = function immutableItems(req, res) {
  return res
    .status(409)
    .json({
      success: false,
      message:
        "Itens de pedidos e compras registrados não podem ser alterados isoladamente. Use o fluxo de cancelamento ou registre uma nova operação.",
    });
};
