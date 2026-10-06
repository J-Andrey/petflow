"use strict";

/* ==================================================
   MODEL
================================================== */

const petModel = require("../models/petModel");

/* ==================================================
   LISTAR
================================================== */

async function index(request, response, next) {

    try {

        const pets = await petModel.findAll(

            request.user.empresaId

        );

        return response.status(200).json({

            success: true,

            data: pets

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

        const pet = await petModel.findById(

            id,

            request.user.empresaId

        );

        if (!pet) {

            return response.status(404).json({

                success: false,

                message: "Pet não encontrado."

            });

        }

        return response.status(200).json({

            success: true,

            data: pet

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

        const pet = await petModel.create({

            ...request.body,

            empresaId: request.user.empresaId,

            foto: request.file?.path || null

        });

        return response.status(201).json({

            success: true,

            message: "Pet cadastrado com sucesso.",

            data: pet

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

        const pet = await petModel.update(

            id,

            {

                ...request.body,

                foto: request.file?.path

            },

            request.user.empresaId

        );

        return response.status(200).json({

            success: true,

            message: "Pet atualizado com sucesso.",

            data: pet

        });

    } catch (error) {

        next(error);

    }

}

/* ==================================================
   EXCLUIR
================================================== */

async function destroy(request, response, next) {

    try {

        const { id } = request.params;

        await petModel.remove(

            id,

            request.user.empresaId

        );

        return response.status(200).json({

            success: true,

            message: "Pet removido com sucesso."

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
