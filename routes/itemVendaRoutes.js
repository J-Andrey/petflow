"use strict";

const express = require("express");

const router = express.Router();

const ItemVendaController = require("../controllers/itemVendaController");

const authMiddleware = require("../middlewares/authMiddleware");

const roleMiddleware = require("../middlewares/roleMiddleware");
const immutableItems = require("../middlewares/immutableItemsMiddleware");

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

    immutableItems

);

router.put(

    "/:id",

    roleMiddleware("ADMIN"),

    immutableItems

);

router.delete(

    "/:id",

    roleMiddleware("ADMIN"),

    immutableItems

);

module.exports = router;
