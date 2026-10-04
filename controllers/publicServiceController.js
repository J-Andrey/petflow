"use strict";

const db = require("../database/connection");

async function pets(request, response, next) {
    try {
        const { rows } = await db.query(
            `
                SELECT
                    id,
                    nome,
                    especie,
                    raca,
                    sexo,
                    porte,
                    peso,
                    observacoes
                FROM pets
                WHERE cliente_id = $1 AND empresa_id=$2
                AND ativo = TRUE
                ORDER BY nome ASC
            `,
            [request.customer.id,request.customer.empresaId]
        );

        return response.status(200).json({
            success: true,
            data: rows
        });
    } catch (error) {
        next(error);
    }
}

async function criarPet(request, response, next) {
    try {
        const data = request.body;

        if (!hasRequiredPetData(data)) {
            return response.status(400).json({
                success: false,
                message: "Informe o nome e a espécie do pet."
            });
        }

        const { rows } = await db.query(
            `
                INSERT INTO pets (
                    cliente_id,
                    empresa_id,
                    nome,
                    especie,
                    raca,
                    sexo,
                    porte,
                    peso,
                    observacoes,
                    ativo
                )
                VALUES ($1,$9,$2,$3,$4,$5,$6,$7,$8,TRUE)
                RETURNING
                    id,
                    nome,
                    especie,
                    raca,
                    sexo,
                    porte,
                    peso,
                    observacoes
            `,
            [...petParams(data, request.customer.id),request.customer.empresaId]
        );

        return response.status(201).json({
            success: true,
            message: "Pet cadastrado com sucesso.",
            data: rows[0]
        });
    } catch (error) {
        next(error);
    }
}

async function atualizarPet(request, response, next) {
    try {
        const data = request.body;

        if (!hasRequiredPetData(data)) {
            return response.status(400).json({
                success: false,
                message: "Informe o nome e a espécie do pet."
            });
        }

        const { rows } = await db.query(
            `
                UPDATE pets
                SET
                    nome = $1,
                    especie = $2,
                    raca = $3,
                    sexo = $4,
                    porte = $5,
                    peso = $6,
                    observacoes = $7,
                    updated_at = NOW()
                WHERE id = $8
                AND cliente_id = $9 AND empresa_id=$10
                AND ativo = TRUE
                RETURNING
                    id,
                    nome,
                    especie,
                    raca,
                    sexo,
                    porte,
                    peso,
                    observacoes
            `,
            [
                data.nome.trim(),
                data.especie.trim(),
                clean(data.raca),
                normalizeEnum(data.sexo),
                normalizeEnum(data.porte),
                normalizeDecimal(data.peso),
                clean(data.observacoes),
                request.params.id,
                request.customer.id,request.customer.empresaId
            ]
        );

        if (!rows[0]) {
            return response.status(404).json({
                success: false,
                message: "Pet não encontrado na sua conta."
            });
        }

        return response.status(200).json({
            success: true,
            message: "Pet atualizado com sucesso.",
            data: rows[0]
        });
    } catch (error) {
        next(error);
    }
}

async function removerPet(request, response, next) {
    try {
        const { rowCount } = await db.query(
            `
                UPDATE pets
                SET
                    ativo = FALSE,
                    updated_at = NOW()
                WHERE id = $1
                AND cliente_id = $2 AND empresa_id=$3
            `,
            [request.params.id, request.customer.id,request.customer.empresaId]
        );

        if (!rowCount) {
            return response.status(404).json({
                success: false,
                message: "Pet não encontrado na sua conta."
            });
        }

        return response.status(200).json({
            success: true,
            message: "Pet removido com sucesso."
        });
    } catch (error) {
        next(error);
    }
}

async function solicitarAgendamento(request,response,next){
    try {
        const data=await require("../services/scheduleService").save(db,request,{
            clienteId:request.customer.id,petId:request.body.petId,servicoId:request.body.servicoId,
            data:request.body.data,hora:request.body.hora,status:"AGENDADO",observacoes:request.body.observacoes
        });
        return response.status(201).json({success:true,message:"Agendamento solicitado.",data});
    }catch(error){next(error);}
}

async function findCustomerPet(id, customerId) {
    const { rows } = await db.query(
        `
            SELECT id
            FROM pets
            WHERE id = $1
            AND cliente_id = $2
            AND ativo = TRUE
            LIMIT 1
        `,
        [id, customerId]
    );

    return rows[0] || null;
}

async function findService(id) {
    const { rows } = await db.query(
        `
            SELECT id, nome, preco
            FROM servicos
            WHERE id = $1
            AND ativo = TRUE
            LIMIT 1
        `,
        [id]
    );

    return rows[0] || null;
}

function petParams(data, clienteId) {
    return [
        clienteId,
        data.nome.trim(),
        data.especie.trim(),
        clean(data.raca),
        normalizeEnum(data.sexo),
        normalizeEnum(data.porte),
        normalizeDecimal(data.peso),
        clean(data.observacoes)
    ];
}

function hasRequiredPetData(data) {
    return Boolean(data?.nome && data?.especie);
}

function clean(value) {
    return value ? String(value).trim() : null;
}

function normalizeEnum(value) {
    return value
        ? String(value).trim().toUpperCase()
        : null;
}

function normalizeDecimal(value) {
    return value === "" || value == null
        ? null
        : Number(value);
}

function isFutureDate(value) {
    const selected = new Date(`${value}T00:00:00`);
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    return (
        !Number.isNaN(selected.getTime()) &&
        selected >= today
    );
}

function isValidServiceTime(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value || ""))) {
        return false;
    }

    const [hours, minutes] = value
        .split(":")
        .map(Number);

    const totalMinutes = (hours * 60) + minutes;

    return (
        minutes >= 0 &&
        minutes <= 59 &&
        totalMinutes >= 8 * 60 &&
        totalMinutes <= 18 * 60
    );
}

module.exports = {
    pets,
    criarPet,
    atualizarPet,
    removerPet,
    solicitarAgendamento
};
