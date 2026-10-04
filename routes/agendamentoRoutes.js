"use strict";

/* ==================================================
   EXPRESS
================================================== */

const express = require("express");

const router = express.Router();

/* ==================================================
   CONTROLLER
================================================== */

const agendamentoController = require("../controllers/agendamentoController");

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

const agendamentoValidation = [

    body("clienteId")

        .isUUID()

        .withMessage("Cliente inválido."),

    body("petId")

        .isUUID()

        .withMessage("Pet inválido."),

    body("funcionarioId")

        .optional({

            nullable: true,

            checkFalsy: true

        })

        .isUUID()

        .withMessage("Funcionário inválido."),

    body("servico")

        .trim()

        .notEmpty()

        .withMessage("Informe o serviço."),

    body("data")

        .isISO8601()

        .withMessage("Data inválida."),

    body("hora")

        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)

        .withMessage("Hora inválida."),

    body("status")

        .trim()

        .isIn([
            "AGENDADO",
            "CONFIRMADO",
            "EM_ANDAMENTO",
            "CONCLUIDO",
            "CANCELADO",
            "FALTOU"
        ])

        .withMessage("Informe um status válido.")

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

    agendamentoController.index

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

    agendamentoController.show

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

    agendamentoValidation,

    validationMiddleware,

    agendamentoController.store

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

    agendamentoValidation,

    validationMiddleware,

    agendamentoController.update

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

    agendamentoController.destroy

);

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = router;
