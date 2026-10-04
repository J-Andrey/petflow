"use strict";

/* ==================================================
   DATABASE
================================================== */

const db = require("../database/connection");

/* ==================================================
   LISTAR
================================================== */

async function findAll(empresaId) {

    const result = await db.query(

        `
            SELECT

                p.id,

                p.nome,

                p.especie,

                p.raca,

                p.sexo,

                p.porte,

                p.idade,

                p.status,

                c.nome AS tutor

            FROM pets p

            INNER JOIN clientes c

                ON c.id = p.cliente_id

            WHERE p.empresa_id = get_petflow_empresa_id()
               OR p.empresa_id IS NULL
               OR ($1::uuid IS NOT NULL AND p.empresa_id = $1)

            ORDER BY p.nome ASC
        `,

        [empresaId]

    );

    return result.rows;

}

/* ==================================================
   BUSCAR POR ID
================================================== */

async function findById(id, empresaId) {

    const result = await db.query(

        `
            SELECT *

            FROM pets

            WHERE id = $1

            AND (
                empresa_id = get_petflow_empresa_id()
                OR empresa_id IS NULL
                OR ($2::uuid IS NOT NULL AND empresa_id = $2)
            )

            LIMIT 1
        `,

        [

            id,

            empresaId

        ]

    );

    return result.rows[0] || null;

}

/* ==================================================
   CADASTRAR
================================================== */

async function create(pet) {

    const result = await db.query(

        `
            INSERT INTO pets (

                empresa_id,

                cliente_id,

                nome,

                especie,

                raca,

                sexo,

                porte,

                idade,

                peso,

                observacoes,

                foto,

                status

            )

            VALUES (

                get_petflow_empresa_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE

            )

            RETURNING *
        `,

        [

            pet.clienteId,

            pet.nome,

            pet.especie,

            pet.raca,

            pet.sexo,

            pet.porte,

            pet.idade,

            pet.peso,

            pet.observacoes,

            pet.foto

        ]

    );

    return result.rows[0];

}

/* ==================================================
   ATUALIZAR
================================================== */

async function update(id, pet, empresaId) {

    const result = await db.query(

        `
            UPDATE pets

            SET

                cliente_id = $1,

                nome = $2,

                especie = $3,

                raca = $4,

                sexo = $5,

                porte = $6,

                idade = $7,

                peso = $8,

                observacoes = $9,

                foto = $10,

                updated_at = NOW()

            WHERE

                id = $11

            AND (
                empresa_id = get_petflow_empresa_id()
                OR empresa_id IS NULL
                OR ($12::uuid IS NOT NULL AND empresa_id = $12)
            )

            RETURNING *
        `,

        [

            pet.clienteId,

            pet.nome,

            pet.especie,

            pet.raca,

            pet.sexo,

            pet.porte,

            pet.idade,

            pet.peso,

            pet.observacoes,

            pet.foto,

            id,

            empresaId

        ]

    );

    return result.rows[0];

}

/* ==================================================
   REMOVER
================================================== */

async function remove(id, empresaId) {

    await db.query(

        `
            UPDATE pets SET ativo=FALSE,updated_at=NOW()

            WHERE

                id = $1

            AND (
                empresa_id = get_petflow_empresa_id()
                OR empresa_id IS NULL
                OR ($2::uuid IS NOT NULL AND empresa_id = $2)
            )
        `,

        [

            id,

            empresaId

        ]

    );

}

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = {

    findAll,

    findById,

    create,

    update,

    remove

};
