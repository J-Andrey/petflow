"use strict";

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { signSession, validPassword, hashToken } = require("../services/sessionService");
const validation = require("../services/customerValidation");
const db = require("../database/connection");
const {
    JWT_SECRET,
    JWT_EXPIRES_IN,
    APP_URL
} = require("../config/env");

const {
    sendEmail,
    emailVerificationTemplate,
    passwordResetTemplate
} = require("../services/emailService");

async function register(request, response, next) {
    try {
        const data = request.body;
        if (!validation.validRegistration(data)) return response.status(400).json({
            success: false, message: "Confira os dados, CPF, endereço, senha de 8 a 72 bytes e aceite os Termos e a Política de Privacidade."
        });
        const senhaHash = await bcrypt.hash(data.senha, 12);
        const token = crypto.randomBytes(32).toString("hex");
        await db.transaction(async client => {
            const company = await client.query("SELECT get_petflow_empresa_id() AS id");
            const empresaId = company.rows[0].id;
            // Serializa cadastros públicos da mesma empresa, além dos índices de unicidade.
            await client.query("SELECT id FROM empresas WHERE id=$1 FOR UPDATE", [empresaId]);
            const phone = validation.digits(data.telefone);
            const whatsapp = validation.digits(data.whatsapp || data.telefone);
            const existing = await client.query(
                "SELECT id FROM clientes WHERE empresa_id=$1 AND (LOWER(email)=LOWER($2) OR regexp_replace(cpf,'[^0-9]','','g')=$3 OR regexp_replace(telefone,'[^0-9]','','g')=ANY($4::text[]) OR regexp_replace(whatsapp,'[^0-9]','','g')=ANY($4::text[])) LIMIT 1",
                [empresaId, data.email.trim(), validation.digits(data.cpf), [phone, whatsapp]]);
            if (existing.rowCount) throw Object.assign(new Error("Dados já cadastrados. Entre na conta ou solicite o reenvio da confirmação."), { status: 409 });
            const created = await client.query(
                "INSERT INTO clientes (empresa_id,nome,cpf,email,telefone,whatsapp,cep,endereco,numero,complemento,bairro,cidade,estado,data_nascimento,ativo,privacidade_versao,privacidade_aceita_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,NOW()) RETURNING id",
                [empresaId,data.nome.trim(),formatCpf(data.cpf),data.email.trim().toLowerCase(),phone,whatsapp,validation.digits(data.cep),data.endereco.trim(),data.numero.trim(),data.complemento||null,data.bairro.trim(),data.cidade.trim(),data.estado.toUpperCase(),data.data_nascimento||null,process.env.PRIVACY_POLICY_VERSION||"2026-10-04"]);
            const id=created.rows[0].id;
            await client.query(
                "INSERT INTO usuarios_clientes (cliente_id,email,senha_hash,email_verificado,token_verificacao_email,token_verificacao_expiracao,ativo) VALUES ($1,$2,$3,FALSE,$4,NOW()+INTERVAL '24 hours',TRUE)",
                [id,data.email.trim().toLowerCase(),senhaHash,hashToken(token)]);
            for (const finalidade of ["PRIVACIDADE","TERMOS"]) await client.query(
                "INSERT INTO lgpd_consentimentos (empresa_id,cliente_id,finalidade,versao,concedido,origem,ip_hash,user_agent_hash) VALUES ($1,$2,$3,$4,TRUE,'SITE',$5,$6)",
                [empresaId,id,finalidade,process.env.PRIVACY_POLICY_VERSION||"2026-10-04",
                    crypto.createHmac("sha256",JWT_SECRET).update(request.ip||"").digest("hex"),
                    crypto.createHmac("sha256",JWT_SECRET).update(request.get("user-agent")||"").digest("hex")]);
            const template=emailVerificationTemplate({name:data.nome,verifyUrl:APP_URL+"/login?verificar_email="+token});
            // Se o envio crítico falhar, todos os inserts são revertidos.
            await sendEmail({to:data.email.trim(),...template,idempotencyKey:"verify-"+hashToken(token)});
        });
        return response.status(201).json({success:true,message:"Cadastro criado. Confirme seu e-mail para entrar."});
    } catch(error) { return next(error); }
}

async function resendVerification(request,response,next) {
    try {
        const email=String(request.body?.email||"").trim().toLowerCase();
        const {rows}=await db.query(
            "SELECT c.id,c.nome,c.email FROM clientes c JOIN usuarios_clientes uc ON uc.cliente_id=c.id WHERE LOWER(c.email)=$1 AND c.empresa_id=get_petflow_empresa_id() AND c.ativo=TRUE AND uc.ativo=TRUE AND uc.email_verificado=FALSE", [email]);
        if (rows[0]) {
            const token=crypto.randomBytes(32).toString("hex");
            await db.query("UPDATE usuarios_clientes SET token_verificacao_email=$1,token_verificacao_expiracao=NOW()+INTERVAL '24 hours' WHERE cliente_id=$2 AND email_verificado=FALSE",[hashToken(token),rows[0].id]);
            const template=emailVerificationTemplate({name:rows[0].nome,verifyUrl:APP_URL+"/login?verificar_email="+token});
            await sendEmail({to:rows[0].email,...template,idempotencyKey:"verify-"+hashToken(token)})
                .catch(()=>console.warn("[email] reenvio de confirmação não enviado"));
        }
        return response.json({success:true,message:"Se houver cadastro pendente, enviaremos um novo link de confirmação."});
    } catch(error) { return next(error); }
}

async function logout(request,response,next) {
    try {
        await db.query("UPDATE usuarios_clientes uc SET sessao_versao=uc.sessao_versao+1 FROM clientes c WHERE uc.cliente_id=c.id AND c.id=$1 AND c.empresa_id=$2",[request.customer.id,request.customer.empresaId]);
        return response.json({success:true,message:"Sessões encerradas."});
    } catch(error) { return next(error); }
}

async function login(request, response, next) {

    try {

        const {
            email,
            senha
        } = request.body;

        const empresaIdResult = await db.query(
            "SELECT get_petflow_empresa_id() AS id"
        );

        const empresaId = empresaIdResult.rows[0].id;

        const { rows } = await db.query(
            `
                SELECT
                    c.*,
                    uc.senha_hash,
                    uc.sessao_versao,
                    uc.email_verificado,
                    uc.ativo AS usuario_ativo
                FROM clientes c
                INNER JOIN usuarios_clientes uc
                    ON uc.cliente_id = c.id
                WHERE LOWER(c.email) = LOWER($1)
                  AND c.empresa_id = $2
                LIMIT 1
            `,
            [
                email,
                empresaId
            ]
        );

        const cliente = rows[0];

        if (
            !cliente ||
            !cliente.usuario_ativo ||
            !cliente.ativo
        ) {

            return response.status(401).json({
                success: false,
                message: "E-mail ou senha inválidos."
            });

        }

        const valid = await bcrypt.compare(
            senha,
            cliente.senha_hash
        );

        if (!valid) {

            return response.status(401).json({
                success: false,
                message: "E-mail ou senha inválidos."
            });

        }

        if (!cliente.email_verificado) {

            return response.status(403).json({
                success: false,
                message: "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada."
            });

        }

        await db.query(
            `
                UPDATE usuarios_clientes
                SET ultimo_login = NOW()
                WHERE cliente_id = $1
            `,
            [cliente.id]
        );

        return response.status(200).json({
            success: true,
            message: "Login realizado com sucesso.",
            data: buildAuthPayload(cliente)
        });

    } catch (error) {

        return next(error);

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

        const empresaIdResult = await db.query(
            "SELECT get_petflow_empresa_id() AS id"
        );

        const empresaId = empresaIdResult.rows[0].id;

        const { rows } = await db.query(
            `
                SELECT
                    c.id,
                    c.nome,
                    c.email,
                    uc.ativo AS usuario_ativo
                FROM clientes c
                INNER JOIN usuarios_clientes uc
                    ON uc.cliente_id = c.id
                WHERE LOWER(c.email) = LOWER($1)
                  AND c.empresa_id = $2
                  AND c.ativo = TRUE
                LIMIT 1
            `,
            [
                email,
                empresaId
            ]
        );

        const cliente = rows[0];

        if (
            !cliente ||
            !cliente.usuario_ativo
        ) {

            return response.status(200).json({
                success: true,
                message: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação."
            });

        }

        const token = crypto
            .randomBytes(32)
            .toString("hex");

        const expiresAt = new Date(
            Date.now() + 1000 * 60 * 30
        );

        await db.query(
            `
                UPDATE usuarios_clientes
                SET
                    token_recuperacao = $1,
                    token_expiracao = $2,
                    updated_at = NOW()
                WHERE cliente_id = $3
            `,
            [
                hashToken(token),
                expiresAt,
                cliente.id
            ]
        );

        const resetUrl =
            `${APP_URL}/redefinir-senha?token=${token}`;

        const template = passwordResetTemplate({
            name: cliente.nome,
            resetUrl
        });

        await sendEmail({
            to: cliente.email,
            subject: template.subject,
            html: template.html,
            text: template.text,
            idempotencyKey: "customer-reset-"+hashToken(token)
        }).catch(()=>console.warn("[email] recuperação de cliente não enviada"));

        return response.status(200).json({
            success: true,
            message: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação."
        });

    } catch (error) {

        return next(error);

    }

}

async function verifyEmail(request, response, next) {

    try {

        const token = String(
            request.query?.token ||
            request.body?.token ||
            ""
        ).trim();

        if (!token) {

            return response.status(400).json({
                success: false,
                message: "Link de confirmação inválido."
            });

        }

        const { rowCount } = await db.query(
            `
                UPDATE usuarios_clientes
                SET
                    email_verificado = TRUE,
                    token_verificacao_email = NULL,
                    token_verificacao_expiracao = NULL,
                    updated_at = NOW()
                WHERE token_verificacao_email = $1
                  AND token_verificacao_expiracao > NOW()
                  AND ativo = TRUE
            `,
            [hashToken(token)]
        );

        if (!rowCount) {

            return response.status(400).json({
                success: false,
                message: "Link de confirmação inválido ou expirado."
            });

        }

        return response.status(200).json({
            success: true,
            message: "E-mail confirmado com sucesso. Você já pode entrar."
        });

    } catch (error) {

        return next(error);

    }

}

async function resetPassword(request,response,next) {
    try {
        const {token,senha}=request.body;
        if (typeof token!=="string" || !/^[a-f0-9]{64}$/.test(token) || !validPassword(senha))
            return response.status(400).json({success:false,message:"Informe o token e uma senha entre 8 e 72 bytes."});
        const hash=await bcrypt.hash(senha,12);
        const {rowCount}=await db.query(
            "UPDATE usuarios_clientes uc SET senha_hash=$1,token_recuperacao=NULL,token_expiracao=NULL,sessao_versao=uc.sessao_versao+1 FROM clientes c WHERE uc.cliente_id=c.id AND uc.token_recuperacao=$2 AND uc.token_expiracao>NOW() AND uc.ativo=TRUE AND c.ativo=TRUE AND c.empresa_id=get_petflow_empresa_id()",
            [hash,hashToken(token)]);
        if (!rowCount) return response.status(400).json({success:false,message:"Link inválido ou expirado."});
        return response.json({success:true,message:"Senha redefinida com sucesso."});
    } catch(error) {return next(error);}
}

async function me(request, response, next) {

    try {

        const customer = getAuthenticatedCustomer(
            request,
            response
        );

        if (!customer) {

            return;

        }

        const profile = await getProfileById(
            customer.id,
            customer.empresaId
        );

        if (!profile) {

            return response.status(404).json({
                success: false,
                message: "Cliente não encontrado."
            });

        }

        return response.status(200).json({
            success: true,
            data: profile
        });

    } catch (error) {

        return next(error);

    }

}

async function update(request, response, next) {

    try {

        const data = request.body;

        const customer = getAuthenticatedCustomer(
            request,
            response
        );

        if (!customer) {

            return;

        }

        if (!validation.validProfile(data)) {

            return response.status(400).json({
                success: false,
                message: "Informe nome, WhatsApp e endereço de entrega."
            });

        }

        const duplicate = await findDuplicateCustomer({
            cpf: data.cpf,
            telefone: data.telefone,
            whatsapp: data.whatsapp,
            excludeId: customer.id,
            empresaId: customer.empresaId
        });

        if (duplicate) {

            return response.status(409).json({
                success: false,
                message: duplicateCustomerMessage(duplicate.field)
            });

        }

        await db.query(
            `
                UPDATE clientes
                SET
                    nome = $1,
                    cpf = $2,
                    telefone = $3,
                    whatsapp = $3,
                    cep = $4,
                    endereco = $5,
                    numero = $6,
                    complemento = $7,
                    bairro = $8,
                    cidade = $9,
                    estado = $10,
                    data_nascimento = $11,
                    updated_at = NOW()
                WHERE id = $12
                  AND empresa_id = $13
            `,
            [
                data.nome,
                formatCpf(data.cpf),
                data.telefone,
                data.cep || null,
                data.endereco || null,
                data.numero || null,
                data.complemento || null,
                data.bairro || null,
                data.cidade || null,
                data.estado || null,
                data.data_nascimento || data.dataNascimento || null,
                customer.id,
                customer.empresaId
            ]
        );

        const profile = await getProfileById(
            customer.id,
            customer.empresaId
        );

        return response.status(200).json({
            success: true,
            message: "Dados atualizados com sucesso.",
            data: profile
        });

    } catch (error) {

        return next(error);

    }

}

async function remove(request,response,next) {
    try {
        const customer=request.customer;
        const protocolo="LGPD-"+crypto.randomBytes(10).toString("hex").toUpperCase();
        await db.transaction(async client=>{
            await client.query("SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 FOR UPDATE",[customer.id,customer.empresaId]);
            await client.query("INSERT INTO lgpd_solicitacoes (protocolo,empresa_id,cliente_id,email_referencia,tipo,detalhes) VALUES ($1,$2,$3,$4,'EXCLUSAO','Exclusão solicitada pelo titular; analisar retenção e operações em aberto.')",[protocolo,customer.empresaId,customer.id,customer.email]);
            await client.query("DELETE FROM newsletter_inscritos WHERE empresa_id=$1 AND LOWER(email)=LOWER($2)",[customer.empresaId,customer.email]);
            await client.query("UPDATE usuarios_clientes SET sessao_versao=sessao_versao+1 WHERE cliente_id=$1",[customer.id]);
        });
        return response.status(202).json({success:true,protocolo,message:"Solicitação de exclusão registrada: "+protocolo+". Dados necessários e atendimentos serão preservados durante a análise."});
    } catch(error) {return next(error);}
}

async function orders(request, response, next) {

    try {

        const customer = getAuthenticatedCustomer(
            request,
            response
        );

        if (!customer) {

            return;

        }

        const { rows } = await db.query(
            `
                SELECT
                    v.id,
                    v.status,
                    CASE
                        WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'CREDIT_CARD'
                            THEN 'CARTAO_CREDITO'
                        WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'DEBIT_CARD'
                            THEN 'CARTAO_DEBITO'
                        WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'PIX'
                            THEN 'PIX'
                        ELSE v.forma_pagamento
                    END AS forma_pagamento,
                    v.pagseguro_checkout_id,
                    v.pagseguro_checkout_url,
                    v.pagseguro_status,
                    v.pagamento_atualizado_em,
                    v.valor_total,
                    v.valor_final,
                    v.data_venda,
                    v.observacoes,
                    c.endereco,
                    c.numero,
                    c.complemento,
                    c.bairro,
                    c.cidade,
                    c.estado,
                    COALESCE(
                        JSON_AGG(
                            JSON_BUILD_OBJECT(
                                'produto', COALESCE(
                                    p.nome,
                                    'Produto'
                                ),
                                'quantidade', iv.quantidade,
                                'preco_unitario', COALESCE(
                                    iv.preco_unitario,
                                    0
                                ),
                                'subtotal', iv.subtotal
                            )
                            ORDER BY p.nome
                        ) FILTER (
                            WHERE iv.id IS NOT NULL
                        ),
                        '[]'::JSON
                    ) AS itens
                FROM vendas v
                LEFT JOIN clientes c
                    ON c.id = v.cliente_id
                   AND c.empresa_id = v.empresa_id
                LEFT JOIN itens_venda iv
                    ON iv.venda_id = v.id
                   AND iv.empresa_id = v.empresa_id
                LEFT JOIN produtos p
                    ON p.id = iv.produto_id
                   AND p.empresa_id = v.empresa_id
                WHERE v.cliente_id = $1
                  AND v.empresa_id = $2
                GROUP BY
                    v.id,
                    c.id
                ORDER BY v.data_venda DESC
                LIMIT 50
            `,
            [
                customer.id,
                customer.empresaId
            ]
        );

        return response.status(200).json({
            success: true,
            data: rows
        });

    } catch (error) {

        return next(error);

    }

}

async function notifications(request, response, next) {

    try {

        const customer = getAuthenticatedCustomer(
            request,
            response
        );

        if (!customer) {

            return;

        }

        const { rows } = await db.query(
            `
                SELECT
                    id,
                    titulo,
                    mensagem,
                    tipo,
                    lida,
                    enviada_em
                FROM notificacoes
                WHERE cliente_id = $1
                  AND EXISTS (
                      SELECT 1
                      FROM clientes c
                      WHERE c.id = notificacoes.cliente_id
                        AND c.empresa_id = $2
                  )
                ORDER BY enviada_em DESC
                LIMIT 20
            `,
            [
                customer.id,
                customer.empresaId
            ]
        );

        return response.status(200).json({
            success: true,
            data: rows
        });

    } catch (error) {

        return next(error);

    }

}

async function markNotificationRead(request, response, next) {

    try {

        const customer = getAuthenticatedCustomer(
            request,
            response
        );

        if (!customer) {

            return;

        }

        await db.query(
            `
                UPDATE notificacoes
                SET
                    lida = TRUE,
                    data_leitura = COALESCE(data_leitura, NOW()),
                    updated_at = NOW()
                WHERE cliente_id = $1
                  AND EXISTS (
                      SELECT 1
                      FROM clientes c
                      WHERE c.id = notificacoes.cliente_id
                        AND c.empresa_id = $3
                  )
                  AND (
                      $2::uuid IS NULL
                      OR id = $2
                  )
            `,
            [
                customer.id,
                request.params.id || null,
                customer.empresaId
            ]
        );

        return response.status(200).json({
            success: true,
            message: "Notificação marcada como lida."
        });

    } catch (error) {

        return next(error);

    }

}

async function getProfileById(id, empresaId) {

    const { rows } = await db.query(
        `
            SELECT
                id,
                empresa_id,
                nome,
                cpf,
                email,
                telefone,
                whatsapp,
                cep,
                endereco,
                numero,
                complemento,
                bairro,
                cidade,
                estado,
                data_nascimento
            FROM clientes
            WHERE id = $1
              AND empresa_id = $2
            LIMIT 1
        `,
        [
            id,
            empresaId
        ]
    );

    return rows[0] || null;

}

function buildAuthPayload(cliente) {

    const user = {
        id: cliente.id,
        empresaId: cliente.empresa_id,
        nome: cliente.nome,
        cpf: cliente.cpf,
        email: cliente.email,
        telefone: cliente.telefone,
        cep: cliente.cep,
        endereco: cliente.endereco,
        numero: cliente.numero,
        complemento: cliente.complemento,
        bairro: cliente.bairro,
        cidade: cliente.cidade,
        estado: cliente.estado,
        data_nascimento: cliente.data_nascimento
    };

    const token = signSession(cliente, "customer", JWT_SECRET, JWT_EXPIRES_IN);

    return {
        token,
        user
    };

}

function getAuthenticatedCustomer(request, response) {

    const id = request.customer?.id;
    const empresaId = request.customer?.empresaId;

    if (
        !id ||
        !empresaId
    ) {

        response.status(401).json({
            success: false,
            message: "Sessão inválida. Faça login novamente."
        });

        return null;

    }

    return {
        id,
        empresaId
    };

}

/* ==================================================
   VALIDAÇÕES
================================================== */

function hasRequiredRegistrationData(data) {

    return Boolean(
        hasRequiredProfileData(data) &&
        hasText(data.email) &&
        hasText(data.senha) &&
        String(data.senha).length >= 6
    );

}

function hasRequiredProfileData(data) {

    return Boolean(
        hasText(data?.nome) &&
        isValidCpf(data?.cpf) &&
        hasText(data?.telefone) &&
        hasRequiredAddressData(data)
    );

}

function hasRequiredAddressData(data) {

    return Boolean(
        hasText(data?.cep) &&
        hasText(data?.endereco) &&
        hasText(data?.numero) &&
        hasText(data?.bairro) &&
        hasText(data?.cidade) &&
        hasText(data?.estado)
    );

}

function hasText(value) {

    return (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
    );

}

function onlyDigits(value) {

    return String(value || "")
        .replace(/\D/g, "");

}

function isValidCpf(value) {

    return validation.validCpf(value);

}

function formatCpf(value) {

    const digits = onlyDigits(value);

    if (!isValidCpf(digits)) {

        return null;

    }

    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;

}

async function findDuplicateCustomer({
    cpf,
    telefone,
    whatsapp,
    excludeId,
    empresaId
}) {

    const normalizedCpf = onlyDigits(cpf);
    const normalizedTelefone = onlyDigits(telefone);
    const normalizedWhatsapp = onlyDigits(whatsapp);

    const { rows } = await db.query(
        `
            SELECT
                id,
                CASE
                    WHEN $1 <> ''
                     AND REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = $1 THEN 'cpf'
                    WHEN $4 <> ''
                     AND (
                        REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') = $4
                        OR REGEXP_REPLACE(COALESCE(whatsapp, ''), '\\D', '', 'g') = $4
                     ) THEN 'telefone'
                    WHEN $5 <> ''
                     AND (
                        REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') = $5
                        OR REGEXP_REPLACE(COALESCE(whatsapp, ''), '\\D', '', 'g') = $5
                     ) THEN 'whatsapp'
                    ELSE NULL
                END AS field
            FROM clientes
            WHERE id <> $2
              AND empresa_id = $3
              AND (
                  (
                      $1 <> ''
                      AND REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = $1
                  )
                  OR (
                      $4 <> ''
                      AND (
                          REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') = $4
                          OR REGEXP_REPLACE(COALESCE(whatsapp, ''), '\\D', '', 'g') = $4
                      )
                  )
                  OR (
                      $5 <> ''
                      AND (
                          REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') = $5
                          OR REGEXP_REPLACE(COALESCE(whatsapp, ''), '\\D', '', 'g') = $5
                      )
                  )
              )
            LIMIT 1
        `,
        [
            normalizedCpf,
            excludeId,
            empresaId,
            normalizedTelefone,
            normalizedWhatsapp
        ]
    );

    return rows[0] || null;

}

function duplicateCustomerMessage(field) {

    const messages = {
        cpf: "Esse CPF já está cadastrado.",
        telefone: "Esse telefone já está cadastrado.",
        whatsapp: "Esse celular já está cadastrado.",
        email: "Esse e-mail já está cadastrado."
    };

    return messages[field] || messages.email;

}

async function createCustomerNotification({ clienteId, titulo, mensagem, tipo }) {

    await db.query(
        `
            INSERT INTO notificacoes (
                cliente_id,
                titulo,
                mensagem,
                tipo
            )
            VALUES ($1, $2, $3, $4)
        `,
        [
            clienteId,
            titulo,
            mensagem,
            tipo || "SISTEMA"
        ]
    );

}

function firstName(name) {

    return String(name || "Cliente").trim().split(/\s+/)[0] || "Cliente";

}

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = {
    register,
    resendVerification,
    logout,
    login,
    forgotPassword,
    verifyEmail,
    resetPassword,
    me,
    update,
    remove,
    orders,
    notifications,
    markNotificationRead
};
