"use strict";
const db = require("../database/connection");

async function findAll(empresaId) {
    const { rows } = await db.query(`SELECT p.*, c.nome AS tutor FROM pets p
        JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        WHERE p.empresa_id=$1 ORDER BY p.nome,p.id`, [empresaId]);
    return rows;
}
async function findById(id, empresaId) {
    const { rows } = await db.query("SELECT * FROM pets WHERE id=$1 AND empresa_id=$2", [id, empresaId]);
    return rows[0] || null;
}
async function save(id, pet, empresaId) {
    return db.transaction(async client => {
        const before = id ? (await client.query("SELECT * FROM pets WHERE id=$1 AND empresa_id=$2 FOR UPDATE", [id, empresaId])).rows[0] : null;
        if (id && !before) throw Object.assign(new Error("Pet não encontrado."), { status: 404 });
        if (before && before.cliente_id !== pet.clienteId) {
            const history = await client.query(`SELECT EXISTS(SELECT 1 FROM agendamentos WHERE pet_id=$1 AND empresa_id=$2)
                OR EXISTS(SELECT 1 FROM consultas WHERE pet_id=$1 AND empresa_id=$2)
                OR EXISTS(SELECT 1 FROM historico_vacinas WHERE pet_id=$1 AND empresa_id=$2) AS presente`, [id,empresaId]);
            if (history.rows[0].presente) throw Object.assign(new Error("Pet com histórico exige análise para transferência de tutor."), {status:409});
        }
        const owner = await client.query("SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 AND ativo=TRUE FOR SHARE", [pet.clienteId, empresaId]);
        if (!owner.rows[0]) throw Object.assign(new Error("Tutor inválido para esta empresa."), { status: 400 });
        const values = [empresaId, pet.clienteId, pet.nome, pet.especie, pet.raca || null, pet.sexo || null,
            pet.porte || null, pet.idade ?? null, pet.peso ?? null, pet.observacoes || null,
            pet.foto === undefined ? (before?.foto || null) : pet.foto];
        const { rows } = id ? await client.query(`UPDATE pets SET cliente_id=$2,nome=$3,especie=$4,raca=$5,
            sexo=$6,porte=$7,idade=$8,peso=$9,observacoes=$10,foto=$11,updated_at=NOW()
            WHERE empresa_id=$1 AND id=$12 RETURNING *`, [...values, id]) :
            await client.query(`INSERT INTO pets(empresa_id,cliente_id,nome,especie,raca,sexo,porte,idade,peso,observacoes,foto)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, values);
        return rows[0];
    });
}
const create = pet => save(null, pet, pet.empresaId);
const update = (id, pet, empresaId) => save(id, pet, empresaId);
async function remove(id, empresaId) {
    const { rows } = await db.query("UPDATE pets SET ativo=FALSE,status=FALSE,updated_at=NOW() WHERE id=$1 AND empresa_id=$2 RETURNING id", [id, empresaId]);
    if (!rows[0]) throw Object.assign(new Error("Pet não encontrado."), { status: 404 });
}
module.exports = { findAll, findById, create, update, remove };

