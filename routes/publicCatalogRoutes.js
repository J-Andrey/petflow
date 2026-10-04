"use strict";

const express = require("express");

const publicCatalogController = require("../controllers/publicCatalogController");
const publicOrderController = require("../controllers/publicOrderController");
const publicCustomerController = require("../controllers/publicCustomerController");
const publicServiceController = require("../controllers/publicServiceController");
const newsletterController = require("../controllers/newsletterController");
const customerAuthMiddleware = require("../middlewares/customerAuthMiddleware");

const router = express.Router();
router.use(["/clientes/login","/clientes/cadastro","/clientes/reenviar-confirmacao","/clientes/esqueci-senha","/clientes/redefinir-senha"], require("../middlewares/authRateLimit"));

router.get("/produtos", publicCatalogController.produtos);
router.get("/categorias", publicCatalogController.categorias);
router.get("/servicos", publicCatalogController.servicos);
router.post("/newsletter", newsletterController.subscribe);
router.get("/newsletter/cancelar", newsletterController.unsubscribe);
router.post("/clientes/cadastro", publicCustomerController.register);
router.post("/clientes/login", publicCustomerController.login);
router.post("/clientes/reenviar-confirmacao", publicCustomerController.resendVerification);
router.post("/clientes/logout", customerAuthMiddleware, publicCustomerController.logout);
router.get("/clientes/verificar-email", publicCustomerController.verifyEmail);
router.post("/clientes/verificar-email", publicCustomerController.verifyEmail);
router.post("/clientes/esqueci-senha", publicCustomerController.forgotPassword);
router.post("/clientes/redefinir-senha", publicCustomerController.resetPassword);
router.get("/clientes/me", customerAuthMiddleware, publicCustomerController.me);
router.put("/clientes/me", customerAuthMiddleware, publicCustomerController.update);
router.delete("/clientes/me", customerAuthMiddleware, publicCustomerController.remove);
router.get("/clientes/pedidos", customerAuthMiddleware, publicCustomerController.orders);
router.get("/clientes/notificacoes", customerAuthMiddleware, publicCustomerController.notifications);
router.patch("/clientes/notificacoes/lidas", customerAuthMiddleware, publicCustomerController.markNotificationRead);
router.patch("/clientes/notificacoes/:id/lida", customerAuthMiddleware, publicCustomerController.markNotificationRead);
router.get("/clientes/pets", customerAuthMiddleware, publicServiceController.pets);
router.post("/clientes/pets", customerAuthMiddleware, publicServiceController.criarPet);
router.put("/clientes/pets/:id", customerAuthMiddleware, publicServiceController.atualizarPet);
router.delete("/clientes/pets/:id", customerAuthMiddleware, publicServiceController.removerPet);
router.post("/pedidos", customerAuthMiddleware, publicOrderController.criarPedido);
router.post("/agendamentos", customerAuthMiddleware, publicServiceController.solicitarAgendamento);

module.exports = router;
