"use strict";

const db = require("../database/connection");

function normalizeEmail(email) {
    return String(email || "")
        .trim()
        .toLowerCase();
}

function onlyDigits(value) {
    return String(value || "")
        .replace(/\D/g, "");
}

function duplicateMessage(field) {
    const messages = {
        cpf: "Esse CPF já está cadastrado.",
        telefone: "Esse telefone já está cadastrado.",
        whatsapp: "Esse celular já está cadastrado.",
        email: "Esse e-mail já está cadastrado."
    };

    return messages[field] || messages.email;
}

async function findDuplicate({
    email,
    cpf,
    telefone,
    whatsapp,
    excludeId = null,
    empresaId = null
}) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedCpf = onlyDigits(cpf);
    const normalizedTelefone = onlyDigits(telefone);
    const normalizedWhatsapp = onlyDigits(whatsapp);

    if (
        !normalizedEmail &&
        !normalizedCpf &&
        !normalizedTelefone &&
        !normalizedWhatsapp
    ) {
        return null;
    }

    const result = await db.query(
        `
            SELECT
                id,
                CASE
                    WHEN $1 <> ''
                     AND LOWER(TRIM(email)) = $1 THEN 'email'
                    WHEN $2 <> ''
                     AND REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = $2 THEN 'cpf'
                    WHEN $5 <> ''
                     AND (
                        REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') = $5
                        OR REGEXP_REPLACE(COALESCE(whatsapp, ''), '\\D', '', 'g') = $5
                     ) THEN 'telefone'
                    WHEN $6 <> ''
                     AND (
                        REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') = $6
                        OR REGEXP_REPLACE(COALESCE(whatsapp, ''), '\\D', '', 'g') = $6
                     ) THEN 'whatsapp'
                    ELSE NULL
                END AS field
            FROM clientes c
            WHERE ($3::uuid IS NULL OR id <> $3)
              AND empresa_id = $4
              AND (
                  (
                      $1 <> ''
                      AND LOWER(TRIM(email)) = $1
                  )
                  OR (
                      $2 <> ''
                      AND REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = $2
                  )
                  OR (
                      $5 <> ''
                      AND (
                          REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') = $5
                          OR REGEXP_REPLACE(COALESCE(whatsapp, ''), '\\D', '', 'g') = $5
                      )
                  )
                  OR (
                      $6 <> ''
                      AND (
                          REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') = $6
                          OR REGEXP_REPLACE(COALESCE(whatsapp, ''), '\\D', '', 'g') = $6
                      )
                  )
              )
            LIMIT 1
        `,
        [
            normalizedEmail,
            normalizedCpf,
            excludeId,
            empresaId || null,
            normalizedTelefone,
            normalizedWhatsapp
        ]
    );

    return result.rows[0] || null;
}

async function findAll(empresaId) {
    const result = await db.query(
        `
            SELECT
                c.id,
                c.nome,
                c.cpf,
                c.data_nascimento,
                c.telefone,
                c.whatsapp,
                COALESCE(c.email, uc.email) AS email,
                c.cep,
                c.endereco,
                c.numero,
                c.complemento,
                c.bairro,
                c.cidade,
                c.estado,
                c.ativo,
                CASE
                    WHEN c.ativo = TRUE THEN 'ativo'
                    ELSE 'inativo'
                END AS status,
                COUNT(p.id)::INTEGER AS total_pets,
                COALESCE(
                    STRING_AGG(
                        DISTINCT p.nome,
                        ', '
                    ) FILTER (WHERE p.id IS NOT NULL),
                    'Nenhum pet cadastrado'
                ) AS pets,
                CONCAT_WS(
                    ', ',
                    NULLIF(c.endereco, ''),
                    NULLIF(c.numero, ''),
                    NULLIF(c.complemento, ''),
                    NULLIF(c.bairro, ''),
                    NULLIF(c.cidade, ''),
                    NULLIF(c.estado, '')
                ) AS endereco_completo,
                c.created_at,
                c.updated_at
            FROM clientes c
            LEFT JOIN usuarios_clientes uc
                ON uc.cliente_id = c.id
            LEFT JOIN pets p
                ON p.cliente_id = c.id
               AND p.ativo = TRUE
               AND p.empresa_id = c.empresa_id
            WHERE c.empresa_id = $1
            GROUP BY c.id, uc.email
            ORDER BY c.nome ASC
        `,
        [empresaId || null]
    );

    return result.rows;
}

async function findById(id, empresaId) {
    const result = await db.query(
        `
            SELECT *
            FROM clientes
            WHERE id = $1
              AND empresa_id = $2
            LIMIT 1
        `,
        [id, empresaId || null]
    );

    return result.rows[0] || null;
}

async function create(cliente) {
    const duplicate = await findDuplicate({
        email: cliente.email,
        cpf: cliente.cpf,
        telefone: cliente.telefone,
        whatsapp: cliente.whatsapp,
        empresaId: cliente.empresaId
    });

    if (duplicate) {
        const error = new Error(duplicateMessage(duplicate.field));

        error.status = 409;
        error.statusCode = 409;
        throw error;
    }

    const result = await db.query(
        `
            INSERT INTO clientes (
                empresa_id,
                nome,
                cpf,
                data_nascimento,
                telefone,
                whatsapp,
                email,
                cep,
                endereco,
                numero,
                complemento,
                bairro,
                cidade,
                estado,
                observacoes,
                ativo
            )
            VALUES (
                $15,
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE
            )
            RETURNING *
        `,
        [
            cliente.nome,
            cliente.cpf,
            cliente.dataNascimento || cliente.data_nascimento || null,
            cliente.telefone,
            cliente.whatsapp || null,
            cliente.email,
            cliente.cep || null,
            cliente.endereco || null,
            cliente.numero || null,
            cliente.complemento || null,
            cliente.bairro || null,
            cliente.cidade || null,
            cliente.estado || null,
            cliente.observacoes || null,
            cliente.empresaId
        ]
    );

    return result.rows[0];
}

async function update(id, cliente, empresaId) {
    const duplicate = await findDuplicate({
        email: cliente.email,
        cpf: cliente.cpf,
        telefone: cliente.telefone,
        whatsapp: cliente.whatsapp,
        excludeId: id,
        empresaId
    });

    if (duplicate) {
        const error = new Error(duplicateMessage(duplicate.field));

        error.status = 409;
        error.statusCode = 409;
        throw error;
    }

    const result = await db.query(
        `
            UPDATE clientes
            SET
                nome = $1,
                cpf = $2,
                data_nascimento = $3,
                telefone = $4,
                whatsapp = $5,
                email = $6,
                cep = $7,
                endereco = $8,
                numero = $9,
                complemento = $10,
                bairro = $11,
                cidade = $12,
                estado = $13,
                observacoes = $14,
                updated_at = NOW()
            WHERE id = $15
              AND empresa_id = $16
            RETURNING *
        `,
        [
            cliente.nome,
            cliente.cpf,
            cliente.dataNascimento || cliente.data_nascimento || null,
            cliente.telefone,
            cliente.whatsapp || null,
            cliente.email,
            cliente.cep || null,
            cliente.endereco || null,
            cliente.numero || null,
            cliente.complemento || null,
            cliente.bairro || null,
            cliente.cidade || null,
            cliente.estado || null,
            cliente.observacoes || null,
            id,
            empresaId || null
        ]
    );

    if (!result.rows[0]) throw Object.assign(new Error("Cliente não encontrado."), {status:404});
    return result.rows[0];
}

async function remove(id, empresaId) {
    const result = await db.query(
        `
            UPDATE clientes
            SET ativo = FALSE,
                updated_at = NOW()
            WHERE id = $1
              AND empresa_id = $2 RETURNING id
        `,
        [id, empresaId || null]
    );
    if (!result.rows[0]) throw Object.assign(new Error("Cliente não encontrado."), {status:404});
}

module.exports = {
    findAll,
    findById,
    findDuplicate,
    duplicateMessage,
    create,
    update,
    remove
};
