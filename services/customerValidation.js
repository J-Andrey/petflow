"use strict";
const { validPassword } = require("./sessionService");
const digits = value => String(value || "").replace(/\D/g, "");
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
function validCpf(value) {
    const cpf = digits(value);
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let size = 9; size <= 10; size++) {
        let sum = 0;
        for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
        const check = (sum * 10) % 11;
        if ((check === 10 ? 0 : check) !== Number(cpf[size])) return false;
    }
    return true;
}
function text(value, min, max) {
    return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}
function validProfile(data) {
    return !!data && text(data.nome, 3, 150) && validCpf(data.cpf) &&
        /^\d{10,11}$/.test(digits(data.telefone)) &&
        (!data.whatsapp || /^\d{10,11}$/.test(digits(data.whatsapp))) &&
        /^\d{8}$/.test(digits(data.cep)) && text(data.endereco, 3, 160) &&
        text(data.numero, 1, 20) && text(data.bairro, 2, 80) && text(data.cidade, 2, 80) &&
        states.has(String(data.estado).toUpperCase()) && (!data.complemento || text(data.complemento, 1, 150));
}
function validRegistration(data) {
    return validProfile(data) && validPassword(data.senha) &&
        typeof data.email === "string" && data.email.length <= 150 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) &&
        [true, "true", "on"].includes(data.aceite_privacidade) &&
        [true, "true", "on"].includes(data.aceite_termos);
}
module.exports = { digits, validCpf, validProfile, validRegistration };
