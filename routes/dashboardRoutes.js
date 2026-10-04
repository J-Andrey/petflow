"use strict";

const express = require("express");

const router = express.Router();

const DashboardController = require("../controllers/dashboardController");

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

/* ==============================================
   TODAS AS ROTAS EXIGEM AUTENTICAÇÃO
============================================== */

router.use(authMiddleware);

/* ==============================================
   DASHBOARD COMPLETO
============================================== */

router.get(

    "/",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.dashboard

);

/* ==============================================
   RESUMO
============================================== */

router.get(

    "/resumo",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.resumo

);

/* ==============================================
   ÚLTIMAS VENDAS
============================================== */

router.get(

    "/ultimas-vendas",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.ultimasVendas

);

/* ==============================================
   ÚLTIMAS COMPRAS
============================================== */

router.get(

    "/ultimas-compras",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.ultimasCompras

);

/* ==============================================
   ESTOQUE BAIXO
============================================== */

router.get(

    "/estoque-baixo",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.estoqueBaixo

);

/* ==============================================
   AGENDAMENTOS DE HOJE
============================================== */

router.get(

    "/agendamentos-hoje",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.agendamentosHoje

);

/* ==============================================
   CONTAS VENCIDAS
============================================== */

router.get(

    "/contas-vencidas",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.contasVencidas

);

/* ==============================================
   PRODUTOS MAIS VENDIDOS
============================================== */

router.get(

    "/produtos-mais-vendidos",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.produtosMaisVendidos

);

/* ==============================================
   SERVIÇOS MAIS REALIZADOS
============================================== */

router.get(

    "/servicos-mais-realizados",

    roleMiddleware("ADMIN", "GERENTE"),

    DashboardController.servicosMaisRealizados

);

module.exports = router;