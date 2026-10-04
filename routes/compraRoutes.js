"use strict";

const express = require("express");

const router = express.Router();

const compraController = require("../controllers/compraController");

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

// Listar compras
router.get(
    "/",
    authMiddleware,
    roleMiddleware("ADMIN", "GERENTE"),
    compraController.listar
);

// Buscar compra por ID
router.get(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN", "GERENTE"),
    compraController.buscarPorId
);

// Cadastrar compra
router.post(
    "/",
    authMiddleware,
    roleMiddleware("ADMIN"),
    compraController.criar
);

// Atualizar compra
router.put(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN"),
    compraController.atualizar
);

// Excluir compra
router.delete(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN"),
    compraController.excluir
);

module.exports = router;