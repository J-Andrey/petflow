"use strict";

/* ==================================================
   MODEL
================================================== */

const agendamentoModel = require("../models/agendamentoModel");
const schedule = require("../services/scheduleService");
const db = require("../database/connection");

/* ==================================================
   LISTAR
================================================== */

async function index(request, response, next) {

    try {

        const agendamentos = await agendamentoModel.findAll(

            request.user.empresaId

        );

        return response.status(200).json({

            success: true,

            data: agendamentos

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

        const agendamento = await agendamentoModel.findById(

            id,

            request.user.empresaId

        );

        if (!agendamento) {

            return response.status(404).json({

                success: false,

                message: "Agendamento não encontrado."

            });

        }

        return response.status(200).json({

            success: true,

            data: agendamento

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

        const agendamento = await schedule.save(db,request,request.body);

        return response.status(201).json({

            success: true,

            message: "Agendamento realizado com sucesso.",

            data: agendamento

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

        const agendamento = await schedule.save(db,request,request.body,id);

        return response.status(200).json({

            success: true,

            message: "Agendamento atualizado com sucesso.",

            data: agendamento

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

        const current=await agendamentoModel.findById(id,request.user.empresaId);
        if(!current)return response.status(404).json({success:false,message:"Agendamento não encontrado."});
        await schedule.save(db,request,{
            clienteId:current.cliente_id,petId:current.pet_id,funcionarioId:current.funcionario_id,
            servicoId:current.servico_id,servico:current.servico,
            data:new Date(current.data_agendamento).toISOString().slice(0,10),hora:String(current.horario).slice(0,5),
            status:"CANCELADO",motivo:request.body?.motivo||"Cancelado pelo painel administrativo."
        },id);
        return response.status(200).json({

            success: true,

            message: "Agendamento cancelado. Histórico preservado."

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