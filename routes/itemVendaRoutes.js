"use strict";

const express = require("express");

const router = express.Router();

const ItemVendaController = require("../controllers/itemVendaController");

const authMiddleware = require("../middlewares/authMiddleware");

const roleMiddleware = require("../middlewares/roleMiddleware");

/* ===========================================
   TODAS AS ROTAS EXIGEM LOGIN
=========================================== */

router.use(authMiddleware);

/* ===========================================
   CONSULTAS
=========================================== */

router.get(

    "/venda/:vendaId",

    roleMiddleware("ADMIN", "GERENTE"),

    ItemVendaController.listar

);

router.get(

    "/:id",

    roleMiddleware("ADMIN", "GERENTE"),

    ItemVendaController.buscarPorId

);

/* ===========================================
   ESCRITA
=========================================== */

router.post(

    "/",

    roleMiddleware("ADMIN", "GERENTE"),

    ItemVendaController.criar

);

router.put(

    "/:id",

    roleMiddleware("ADMIN"),

    ItemVendaController.atualizar

);

router.delete(

    "/:id",

    roleMiddleware("ADMIN"),

    ItemVendaController.excluir

);

module.exports = router;