"use strict";

const express = require("express");

const router = express.Router();

const fornecedorController = require("../controllers/fornecedorController");

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

// Listar fornecedores
router.get(
    "/",
    authMiddleware,
    roleMiddleware("ADMIN", "GERENTE"),
    fornecedorController.listar
);

// Buscar fornecedor por ID
router.get(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN", "GERENTE"),
    fornecedorController.buscarPorId
);

// Cadastrar fornecedor
router.post(
    "/",
    authMiddleware,
    roleMiddleware("ADMIN"),
    fornecedorController.criar
);

// Atualizar fornecedor
router.put(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN"),
    fornecedorController.atualizar
);

// Excluir fornecedor
router.delete(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN"),
    fornecedorController.excluir
);

module.exports = router;