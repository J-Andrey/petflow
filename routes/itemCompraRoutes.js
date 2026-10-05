"use strict";

const express = require("express");

const router = express.Router();

const itemCompraController = require("../controllers/itemCompraController");

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const immutableItems = require("../middlewares/immutableItemsMiddleware");

// Listar itens de uma compra
router.get(
    "/compra/:compraId",
    authMiddleware,
    roleMiddleware("ADMIN", "GERENTE"),
    itemCompraController.listar
);

// Buscar item por ID
router.get(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN", "GERENTE"),
    itemCompraController.buscarPorId
);

// Adicionar item à compra
router.post(
    "/",
    authMiddleware,
    roleMiddleware("ADMIN"),
    immutableItems
);

// Atualizar item da compra
router.put(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN"),
    immutableItems
);

// Excluir item da compra
router.delete(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN"),
    immutableItems
);

module.exports = router;
