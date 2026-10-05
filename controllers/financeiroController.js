"use strict";

const FinanceiroModel = require("../models/financeiroModel");
const operations = require("../services/financialAdminService");
const db = require("../database/connection");

async function listar(req, res, next) {
    try {
        const lancamentos = await FinanceiroModel.listar(req.user.empresaId);

        return res.status(200).json({
            success: true,
            data: lancamentos
        });
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const lancamento = await FinanceiroModel.buscarPorId(
            req.params.id,
            req.user.empresaId
        );

        if (!lancamento) {
            return res.status(404).json({
                success: false,
                message: "Lançamento financeiro não encontrado."
            });
        }

        return res.status(200).json({
            success: true,
            data: lancamento
        });
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const lancamento = await operations.save(db, req);

        return res.status(201).json({
            success: true,
            message: "Lançamento financeiro cadastrado com sucesso.",
            data: lancamento
        });
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const lancamento = await operations.save(db, req, req.params.id);

        if (!lancamento) {
            return res.status(404).json({
                success: false,
                message: "Lançamento financeiro não encontrado."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Lançamento financeiro atualizado com sucesso.",
            data: lancamento
        });
    } catch (error) {
        next(error);
    }
}

async function excluir(req, res, next) {
    try {
        const lancamento = await operations.remove(db, req, req.params.id);

        if (!lancamento) {
            return res.status(404).json({
                success: false,
                message: "Lançamento financeiro não encontrado."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Lançamento financeiro cancelado; histórico preservado."
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listar,
    buscarPorId,
    criar,
    atualizar,
    excluir
};
