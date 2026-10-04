"use strict";

/* ==================================================
   EXPRESS
================================================== */

const express = require("express");

const router = express.Router();
router.use(["/login","/forgot-password","/reset-password"], require("../middlewares/authRateLimit"));

/* ==================================================
   CONTROLLER
================================================== */

const authController = require("../controllers/authController");

/* ==================================================
   MIDDLEWARES
================================================== */

const authMiddleware = require("../middlewares/authMiddleware");

const validationMiddleware = require("../middlewares/validationMiddleware");

/* ==================================================
   EXPRESS VALIDATOR
================================================== */

const { body } = require("express-validator");

/* ==================================================
   VALIDAÇÕES
================================================== */

const loginValidation = [

    body("email")

        .trim()

        .notEmpty()

        .withMessage("O e-mail é obrigatório.")

        .isEmail()

        .withMessage("Informe um e-mail válido."),

    body("senha")

        .notEmpty()

        .withMessage("A senha é obrigatória.")

];

/* ==================================================
   LOGIN
================================================== */

router.post(

    "/login",

    loginValidation,

    validationMiddleware,

    authController.login

);

router.post(

    "/forgot-password",

    body("email")
        .trim()
        .isEmail()
        .withMessage("Informe um e-mail válido."),

    validationMiddleware,

    authController.forgotPassword

);

router.post(

    "/reset-password",

    body("token")
        .trim()
        .notEmpty()
        .withMessage("Token obrigatório."),

    body("senha")
        .custom(require("../services/sessionService").validPassword)
        .withMessage("A senha deve ter entre 8 e 72 bytes."),

    validationMiddleware,

    authController.resetPassword

);

/* ==================================================
   PERFIL
================================================== */

router.get(

    "/me",

    authMiddleware,

    authController.me

);

/* ==================================================
   LOGOUT
================================================== */

router.post(

    "/logout",

    authMiddleware,

    authController.logout

);

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = router;
