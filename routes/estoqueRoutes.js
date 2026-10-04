"use strict";

/* ==================================================
   EXPRESS
================================================== */

const express = require("express");

const router = express.Router();

/* ==================================================
   CONTROLLER
================================================== */

const estoqueController = require("../controllers/estoqueController");

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

const estoqueValidation = [

    body("produtoId")

        .isUUID()

        .withMessage("Produto inválido."),

    body("quantidade")

        .isInt({

            min: 0

        })

        .withMessage("Quantidade inválida."),

    body("estoqueMinimo")

        .isInt({

            min: 0

        })

        .withMessage("Estoque mínimo inválido."),

    body("estoqueMaximo")

        .isInt({

            min: 0

        })

        .withMessage("Estoque máximo inválido."),

    body("localizacao")

        .optional()

        .trim()

];

/* ==================================================
   PRODUTO ID
================================================== */

const produtoValidation = [

    param("produtoId")

        .isUUID()

        .withMessage("Produto inválido.")

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

    estoqueController.index

);

/* ==================================================
   BUSCAR
================================================== */

router.get(

    "/:produtoId",

    authMiddleware,

    roleMiddleware(

        "ADMIN",

        "GERENTE"

    ),

    produtoValidation,

    validationMiddleware,

    estoqueController.show

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

    estoqueValidation,

    validationMiddleware,

    estoqueController.store

);

/* ==================================================
   ATUALIZAR
================================================== */

router.put(

    "/:produtoId",

    authMiddleware,

    roleMiddleware(

        "ADMIN"

    ),

    produtoValidation,

    estoqueValidation,

    validationMiddleware,

    estoqueController.update

);

/* ==================================================
   REMOVER
================================================== */

router.delete(

    "/:produtoId",

    authMiddleware,

    roleMiddleware(

        "ADMIN"

    ),

    produtoValidation,

    validationMiddleware,

    estoqueController.destroy

);

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = router;
