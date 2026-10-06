"use strict";

/* ==================================================
   MODEL
================================================== */

const produtoModel = require("../models/produtoModel");

/* ==================================================
   LISTAR
================================================== */

async function index(request, response, next) {

    try {

        const produtos = await produtoModel.findAll(

            request.user.empresaId

        );

        return response.status(200).json({

            success: true,

            data: produtos

        });

    } catch (error) {

        next(error);

    }

}

/* ==================================================
   BUSCAR POR ID
================================================== */

async function show(request, response, next) {

    try {

        const { id } = request.params;

        const produto = await produtoModel.findById(

            id,

            request.user.empresaId

        );

        if (!produto) {

            return response.status(404).json({

                success: false,

                message: "Produto não encontrado."

            });

        }

        return response.status(200).json({

            success: true,

            data: produto

        });

    } catch (error) {

        next(error);

    }

}

/* ==================================================
   CADASTRAR
================================================== */

async function store(request, response, next) {

    try {

        const produto = await produtoModel.create({

            ...request.body,

            empresaId: request.user.empresaId,

            foto: request.file?.path || null

        }, request);

        return response.status(201).json({

            success: true,

            message: "Produto cadastrado com sucesso.",

            data: produto

        });

    } catch (error) {

        next(error);

    }

}

/* ==================================================
   ATUALIZAR
================================================== */

async function update(request, response, next) {

    try {

        const { id } = request.params;

        const produto = await produtoModel.update(

            id,

            {

                ...request.body,

                foto: request.file?.path

            },

            request.user.empresaId,

            request

        );

        return response.status(200).json({

            success: true,

            message: "Produto atualizado com sucesso.",

            data: produto

        });

    } catch (error) {

        next(error);

    }

}

/* ==================================================
   REMOVER
================================================== */

async function destroy(request, response, next) {

    try {

        const { id } = request.params;

        await produtoModel.remove(

            id,

            request.user.empresaId,

            request

        );

        return response.status(200).json({

            success: true,

            message: "Produto desativado com sucesso."

        });

    } catch (error) {

        next(error);

    }

}

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = {

    index,

    show,

    store,

    update,

    destroy

};
