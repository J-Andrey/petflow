"use strict";

const db = require("../database/connection");
const {
    enqueueEmail,
    appointmentReminderTemplate,
    birthdayGreetingTemplate
} = require("./emailService");

const DAY_MS = 24 * 60 * 60 * 1000;
let started = false;

async function runDailyReminders() {
    await Promise.all([
        createAppointmentReminders(),
        createVaccineReminders(),
        createBirthdayMessages()
    ]);
}

function startReminderJob() {
    if (started) {
        return;
    }

    started = true;

    runDailyReminders().catch(error => {
        console.warn("[lembretes] falha ao executar lembretes", {code:error.code||"ERROR"});
    });

    setInterval(() => {
        runDailyReminders().catch(error => {
            console.warn("[lembretes] falha ao executar lembretes", {code:error.code||"ERROR"});
        });
    }, DAY_MS).unref?.();
}

async function createAppointmentReminders() {
    const { rows } = await db.query(
        `
            SELECT
                a.id,
                a.empresa_id,
                a.cliente_id,
                COALESCE(a.servico, s.nome, 'Atendimento') AS servico,
                COALESCE(a.data, a.data_agendamento) AS data,
                COALESCE(a.hora, a.horario) AS hora,
                c.nome AS cliente,
                c.email,
                p.nome AS pet
            FROM agendamentos a
            INNER JOIN clientes c
                ON c.id = a.cliente_id AND c.empresa_id = a.empresa_id
            INNER JOIN pets p
                ON p.id = a.pet_id AND p.empresa_id = a.empresa_id AND p.cliente_id = c.id
            LEFT JOIN servicos s
                ON s.id = a.servico_id AND s.empresa_id = a.empresa_id
            WHERE c.ativo = TRUE
              AND COALESCE(a.data, a.data_agendamento) = CURRENT_DATE + INTERVAL '3 days'
              AND a.status IN ('AGENDADO', 'CONFIRMADO')
        `
    );

    for (const item of rows) {
        const titulo = `Lembrete: ${item.servico} do ${item.pet}`;
        const mensagem = `${item.servico} do ${item.pet} está agendado para ${formatDate(item.data)} às ${formatTime(item.hora)}.`;
        const tipo = classifyAppointment(item.servico);

        await createNotificationOncePerDay({
            clienteId: item.cliente_id,
            titulo,
            mensagem,
            tipo,
            chaveEvento: "agenda-"+item.id+"-"+formatDate(item.data),
            emailOptions: item.email ? { empresaId: item.empresa_id, to: item.email, expiresAt: reminderExpiry(item.data), ...appointmentReminderTemplate({
                name: item.cliente, petName: item.pet, serviceName: item.servico,
                date: item.data, time: item.hora
            }) } : null
        });
    }
}

async function createBirthdayMessages() {
    const { rows } = await db.query(
        `
            SELECT id, empresa_id, nome, email
            FROM clientes
            WHERE ativo = TRUE
              AND data_nascimento IS NOT NULL
              AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
              AND EXTRACT(DAY FROM data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)
        `
    );

    for (const cliente of rows) {
        const titulo = "Feliz aniversário!";
        const mensagem = `${firstName(cliente.nome)}, a PetFlow deseja um feliz aniversário.`;

        await createNotificationOncePerDay({
            clienteId: cliente.id,
            titulo,
            mensagem,
            tipo: "SISTEMA",
            chaveEvento: "aniversario-"+cliente.id+"-"+new Date().getFullYear(),
            emailOptions: cliente.email ? { empresaId: cliente.empresa_id, to: cliente.email, expiresAt: new Date(Date.now()+DAY_MS), ...birthdayGreetingTemplate({name:cliente.nome}) } : null
        });
    }
}
async function createVaccineReminders() {
    const {rows}=await db.query(`SELECT h.id,h.empresa_id,h.proxima_dose,c.id AS cliente_id,c.nome,c.email,p.nome AS pet,v.nome AS vacina
        FROM historico_vacinas h JOIN pets p ON p.id=h.pet_id AND p.empresa_id=h.empresa_id
        JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=h.empresa_id
        JOIN vacinas v ON v.id=h.vacina_id AND v.empresa_id=h.empresa_id
        WHERE c.ativo=TRUE AND p.ativo=TRUE AND h.proxima_dose=CURRENT_DATE+INTERVAL '3 days'`);
    for(const item of rows){
        const message="A próxima dose de "+item.vacina+" de "+item.pet+" está prevista para "+formatDate(item.proxima_dose)+". Agende com a equipe.";
        await createNotificationOncePerDay({clienteId:item.cliente_id,titulo:"Lembrete de vacinação",mensagem:message,tipo:"VACINA",chaveEvento:"vacina-"+item.id+"-"+formatDate(item.proxima_dose),
            emailOptions:item.email?{empresaId:item.empresa_id,to:item.email,expiresAt:reminderExpiry(item.proxima_dose),subject:"PetFlow: lembrete de vacinação",text:message}:null});
    }
}

async function createNotificationOncePerDay({clienteId,titulo,mensagem,tipo,chaveEvento,emailOptions}) {
    return db.transaction(async client => {
        const {rows}=await client.query(
            "INSERT INTO notificacoes(cliente_id,titulo,mensagem,tipo,chave_evento) VALUES($1,$2,$3,$4,$5) ON CONFLICT(cliente_id,chave_evento) WHERE chave_evento IS NOT NULL DO NOTHING RETURNING *",
            [clienteId,titulo,mensagem,tipo,chaveEvento]);
        const created=rows[0]||null;
        if(created&&emailOptions) await enqueueEmail({...emailOptions,idempotencyKey:"lembrete-"+created.id},client);
        return created;
    });
}

function classifyAppointment(serviceName) {
    const text = String(serviceName || "").toLowerCase();

    if (text.includes("vacina")) {
        return "VACINA";
    }

    if (
        text.includes("consulta") ||
        text.includes("veterin") ||
        text.includes("exame")
    ) {
        return "CONSULTA";
    }

    return "AGENDAMENTO";
}

function reminderExpiry(value) {
    const day = new Date(value);
    return Number.isFinite(day.getTime()) ? new Date(day.getTime()+DAY_MS) : undefined;
}

function firstName(name) {
    return String(name || "Cliente").trim().split(/\s+/)[0] || "Cliente";
}

function formatDate(value) {
    if (!value) {
        return "data combinada";
    }

    return new Date(value).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC"
    });
}

function formatTime(value) {
    return String(value || "").slice(0, 5) || "horário combinado";
}

module.exports = {
    startReminderJob,
    runDailyReminders
};
