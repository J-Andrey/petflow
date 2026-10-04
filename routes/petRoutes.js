"use strict";

/* ==================================================
   EXPRESS
================================================== */

const express = require("express");

const router = express.Router();

/* ==================================================
   CONTROLLER
================================================== */

const petController = require("../controllers/petController");

/* ==================================================
   MIDDLEWARES
================================================== */

const authMiddleware = require("../middlewares/authMiddleware");

const roleMiddleware = require("../middlewares/roleMiddleware");

const validationMiddleware = require("../middlewares/validationMiddleware");

const upload = require("../middlewares/uploadMiddleware");

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

const petValidation = [

    body("clienteId")

        .isUUID()

        .withMessage("Cliente inválido."),

    body("nome")

        .trim()

        .notEmpty()

        .withMessage("O nome do pet é obrigatório.")

        .isLength({

            min: 2,

            max: 100

        })

        .withMessage("O nome deve possuir entre 2 e 100 caracteres."),

    body("especie")

        .trim()

        .notEmpty()

        .withMessage("Informe a espécie."),

    body("raca")

        .trim()

        .notEmpty()

        .withMessage("Informe a raça."),

    body("sexo")

        .trim()

        .notEmpty()

        .withMessage("Informe o sexo."),

    body("porte")

        .trim()

        .notEmpty()

        .withMessage("Informe o porte.")

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

    petController.index

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

    petController.show

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

    upload.single("foto"),

    petValidation,

    validationMiddleware,

    petController.store

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

    upload.single("foto"),

    idValidation,

    petValidation,

    validationMiddleware,

    petController.update

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

    petController.destroy

);

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = router;
