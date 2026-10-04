"use strict";

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { signSession, validPassword } = require("../services/sessionService");

const authModel = require("../models/authModel");
const {
    JWT_SECRET,
    JWT_EXPIRES_IN,
    APP_URL
} = require("../config/env");
const {
    sendEmail,
    passwordResetTemplate
} = require("../services/emailService");

async function login(request, response, next) {
    try {
        const { email } = request.body;
        const senha = request.body.senha || request.body.password;

        const usuario = await authModel.findByEmail(email);

        if (!usuario || !usuario.status) {
            return response.status(401).json({
                success: false,
                message: "E-mail ou senha inválidos."
            });
        }

        const senhaValida = await bcrypt.compare(
            senha,
            usuario.senha
        );

        if (!senhaValida) {
            return response.status(401).json({
                success: false,
                message: "E-mail ou senha inválidos."
            });
        }

        await authModel.updateLastLogin(usuario.id);

        const payload = {
            id: usuario.id,
            empresaId: usuario.empresa_id,
            empresa_id: usuario.empresa_id,
            nome: usuario.nome,
            email: usuario.email,
            cargo: usuario.cargo,
            perfil: usuario.cargo,
            type: "admin",
            sessao_versao: usuario.sessao_versao
        };

        const token = signSession(usuario, "admin", JWT_SECRET, JWT_EXPIRES_IN);

        return response.status(200).json({
            success: true,
            message: "Login realizado com sucesso.",
            data: {
                token,
                user: payload
            }
        });
    } catch (error) {
        next(error);
    }
}

async function me(request, response, next) {
    try {
        return response.status(200).json({
            success: true,
            data: request.user
        });
    } catch (error) {
        next(error);
    }
}

async function logout(request, response, next) {
    try {
        await authModel.revokeSessions(request.user.id, request.user.empresaId);
        return response.status(200).json({
            success: true,
            message: "Logout realizado com sucesso."
        });
    } catch (error) {
        next(error);
    }
}

async function forgotPassword(request, response, next) {
    try {
        const { email } = request.body;

        if (!email) {
            return response.status(400).json({
                success: false,
                message: "Informe seu e-mail."
            });
        }

        const usuario = await authModel.findByEmail(email);

        if (!usuario || !usuario.status) {
            return response.status(200).json({
                success: true,
                message: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação."
            });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

        await authModel.setPasswordResetToken(
            usuario.id,
            token,
            expiresAt
        );

        const template = passwordResetTemplate({
            name: usuario.nome,
            resetUrl: `${APP_URL}/redefinir-senha?tipo=admin&token=${token}`
        });

        await sendEmail({
            to: usuario.email,
            subject: template.subject,
            html: template.html,
            text: template.text,
            idempotencyKey: `admin-reset-${require("../services/sessionService").hashToken(token)}`
        }).catch(() => console.warn("[email] recuperação administrativa não enviada"));

        return response.status(200).json({
            success: true,
            message: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação."
        });
    } catch (error) {
        next(error);
    }
}

async function resetPassword(request, response, next) {
    try {
        const { token, senha } = request.body;

        if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || !validPassword(senha)) {
            return response.status(400).json({
                success: false,
                message: "Informe o token e uma senha entre 8 e 72 bytes."
            });
        }

        const senhaHash = await bcrypt.hash(senha, 12);
        const consumed = await authModel.consumePasswordResetToken(token, senhaHash);
        if (!consumed) {
            return response.status(400).json({
                success: false,
                message: "Link inválido ou expirado."
            });
        }

        return response.status(200).json({
            success: true,
            message: "Senha redefinida com sucesso."
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    login,
    me,
    logout,
    forgotPassword,
    resetPassword
};
