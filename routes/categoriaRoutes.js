"use strict";

/* ==================================================
   EXPRESS
================================================== */

const express = require("express");

const router = express.Router();

/* ==================================================
   CONTROLLER
================================================== */

const categoriaController = require("../controllers/categoriaController");

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

const categoriaValidation = [

    body("nome")

        .trim()

        .notEmpty()

        .withMessage("O nome da categoria é obrigatório.")

        .isLength({

            min: 3,

            max: 100

        })

        .withMessage("O nome deve possuir entre 3 e 100 caracteres."),

    body("descricao")

        .optional()

        .trim()

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

    categoriaController.index

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

    categoriaController.show

);

/* ==================================================
   CADASTRAR
================================================== */

router.post(

    "/",

    authMiddleware,

    roleMiddleware(

        "ADMIN"

    ),

    categoriaValidation,

    validationMiddleware,

    categoriaController.store

);

/* ==================================================
   ATUALIZAR
================================================== */

router.put(

    "/:id",

    authMiddleware,

    roleMiddleware(

        "ADMIN"

    ),

    idValidation,

    categoriaValidation,

    validationMiddleware,

    categoriaController.update

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

    categoriaController.destroy

);

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = router;
