"use strict";

/* ==================================================
   EXPRESS
================================================== */

const express = require("express");

const router = express.Router();

/* ==================================================
   CONTROLLER
================================================== */

const clienteController = require("../controllers/clienteController");

/* ==================================================
   MIDDLEWARES
================================================== */

const authMiddleware = require("../middlewares/authMiddleware");

const roleMiddleware = require("../middlewares/roleMiddleware");

const validationMiddleware = require("../middlewares/validationMiddleware");

/* ==================================================
   EXPRESS VALIDATOR
================================================== */

const {

    body,

    param

} = require("express-validator");

/* ==================================================
   VALIDAÇÃO
================================================== */

const clienteValidation = [

    body("nome")

        .trim()

        .notEmpty()

        .withMessage("O nome é obrigatório.")

        .isLength({

            min: 3,

            max: 100

        })

        .withMessage("O nome deve possuir entre 3 e 100 caracteres."),

    body("email")

        .trim()

        .isEmail()

        .withMessage("Informe um e-mail válido."),

    body("telefone")

        .trim()

        .notEmpty()

        .withMessage("O telefone é obrigatório."),

    body("cpf")

        .trim()

        .notEmpty()

        .withMessage("O CPF é obrigatório.")

];

/* ==================================================
   ID
================================================== */

const idValidation = [

    param("id")

        .isUUID()

        .withMessage("ID inválido.")

];

/* ==================================================
   LISTAR
================================================== */

router.get(

    "/",

    authMiddleware,

    roleMiddleware(

        "ADMIN",

        "GERENTE"

    ),

    clienteController.index

);

/* ==================================================
   BUSCAR
================================================== */

router.get(

    "/:id",

    authMiddleware,

    roleMiddleware(

        "ADMIN",

        "GERENTE"

    ),

    idValidation,

    validationMiddleware,

    clienteController.show

);

/* ==================================================
   CADASTRAR
================================================== */

router.post(

    "/",

    authMiddleware,

    roleMiddleware(

        "ADMIN",

        "GERENTE"

    ),

    clienteValidation,

    validationMiddleware,

    clienteController.store

);

/* ==================================================
   ATUALIZAR
================================================== */

router.put(

    "/:id",

    authMiddleware,

    roleMiddleware(

        "ADMIN",

        "GERENTE"

    ),

    idValidation,

    clienteValidation,

    validationMiddleware,

    clienteController.update

);

/* ==================================================
   REMOVER
================================================== */

router.delete(

    "/:id",

    authMiddleware,

    roleMiddleware(

        "ADMIN"

    ),

    idValidation,

    validationMiddleware,

    clienteController.destroy

);

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = router;
