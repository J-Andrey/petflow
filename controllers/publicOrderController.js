"use strict";

/* ==================================================
   DEPENDÊNCIAS
================================================== */

const db = require("../database/connection");
const VendaService = require("../services/vendaService");

const {
    sendOptionalEmail,
    orderReceivedTemplate
} = require("../services/emailService");

/* ==================================================
   CONFIGURAÇÕES
================================================== */

const FORMAS_PAGAMENTO_ACEITAS = [
    "PIX",
    "CARTAO_CREDITO",
    "CARTAO_DEBITO",
    "PAGBANK"
];

const CAMPOS_ENDERECO_OBRIGATORIOS = [
    {
        campo: "endereco",
        nome: "rua"
    },
    {
        campo: "numero",
        nome: "número"
    },
    {
        campo: "bairro",
        nome: "bairro"
    },
    {
        campo: "cidade",
        nome: "cidade"
    },
    {
        campo: "estado",
        nome: "estado"
    }
];

/* ==================================================
   CRIAR PEDIDO
================================================== */

async function criarPedido(request, response, next) {

    try {

        const body = request.body ?? {};

        const itens = body.itens ?? [];

        const formaPagamento = String(
            body.formaPagamento ??
            body.forma_pagamento ??
            "PAGBANK"
        )
            .trim()
            .toUpperCase();

        const observacoes = String(
            body.observacoes ?? ""
        ).trim();

        /* ==========================================
           VALIDA CLIENTE AUTENTICADO
        ========================================== */

        if (!request.customer?.id) {

            return response.status(401).json({
                success: false,
                message: "Faça login para finalizar o pedido."
            });

        }

        /* ==========================================
           VALIDA ITENS
        ========================================== */

        if (!Array.isArray(itens) || itens.length === 0) {

            return response.status(400).json({
                success: false,
                message: "Adicione ao menos um produto na sacola."
            });

        }

        const itensNormalizados = normalizarItens(itens);

        /* ==========================================
           VALIDA FORMA DE PAGAMENTO
        ========================================== */

        if (
            !FORMAS_PAGAMENTO_ACEITAS.includes(
                formaPagamento
            )
        ) {

            return response.status(400).json({
                success: false,
                message: "Forma de pagamento inválida."
            });

        }

        /* ==========================================
           VALIDA OBSERVAÇÕES
        ========================================== */

        if (observacoes.length > 1000) {

            return response.status(400).json({
                success: false,
                message:
                    "As observações devem possuir no máximo 1000 caracteres."
            });

        }

        /* ==========================================
           BUSCA EMPRESA E CLIENTE
        ========================================== */

        const empresaId = request.customer.empresaId;
        const cliente = await getCliente(request.customer.id, empresaId);

        const camposFaltando =
            verificarEndereco(cliente);

        if (camposFaltando.length > 0) {

            return response.status(400).json({
                success: false,
                message:
                    `Complete seu endereço antes de finalizar o pedido. Campos faltando: ${camposFaltando.join(", ")}.`
            });

        }

        /* ==========================================
           FINALIZA PEDIDO

           Não enviamos preço para o service.
           O preço verdadeiro será consultado no banco.
        ========================================== */

        const pedido = await VendaService.finalizarVenda(
            empresaId,
            {
                cliente_id: cliente.id,

                usuario_id: null,

                forma_pagamento: formaPagamento,

                status: "AGUARDANDO_PAGAMENTO",

                desconto: 0,

                acrescimo: 0,

                observacoes: montarObservacoes(
                    cliente,
                    observacoes
                ),

                data_venda: new Date()
            },
            itensNormalizados
        );

        /* ==========================================
           PREPARA ITENS DO E-MAIL

           Os preços utilizados aqui são os preços
           já registrados pelo backend.
        ========================================== */

        const itensDetalhados =
            await getItensDetalhados(
                pedido.itens,
                empresaId
            );

        const emailTemplate = orderReceivedTemplate({
            name: cliente.nome,

            orderId: pedido.venda.id,

            total:
                pedido.venda.valor_final ??
                pedido.venda.valor_total,

            items: itensDetalhados
        });

        /*
        O envio não bloqueia a criação do pedido
        caso o serviço de e-mail não esteja configurado.
        */

        void sendOptionalEmail({
            to: cliente.email,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text
        });

        return response.status(201).json({
            success: true,
            message: "Pedido recebido com sucesso.",

            data: {
                ...pedido.venda,
                itens: pedido.itens
            },

            payment: {
                status: "AGUARDANDO_PAGAMENTO",
                endpoint: "/api/public/pagamentos",
                vendaId: pedido.venda.id
            }
        });

    } catch (error) {

        next(error);

    }

}

/* ==================================================
   NORMALIZAR E VALIDAR ITENS
================================================== */

function normalizarItens(itens) {

    return itens.map((item, index) => {

        if (
            !item ||
            typeof item !== "object" ||
            Array.isArray(item)
        ) {

            const error = new Error(
                `O item ${index + 1} é inválido.`
            );

            error.statusCode = 400;

            throw error;

        }

        const produtoId =
            item.produto_id ??
            item.produtoId;

        const quantidade = Number(
            item.quantidade
        );

        if (!produtoId) {

            const error = new Error(
                `O produto do item ${index + 1} não foi informado.`
            );

            error.statusCode = 400;

            throw error;

        }

        if (
            !Number.isInteger(quantidade) ||
            quantidade <= 0
        ) {

            const error = new Error(
                `A quantidade do item ${index + 1} deve ser um número inteiro maior que zero.`
            );

            error.statusCode = 400;

            throw error;

        }

        return {
            produto_id: produtoId,
            quantidade
        };

    });

}

/* ==================================================
   BUSCAR CLIENTE
================================================== */

async function getCliente(id, empresaId) {

    const { rows } = await db.query(
        `
            SELECT
                id,
                nome,
                email,
                telefone,
                cep,
                endereco,
                numero,
                complemento,
                bairro,
                cidade,
                estado
            FROM clientes
            WHERE id = $1 AND empresa_id = $2 AND ativo = TRUE
            LIMIT 1;
        `,
        [id, empresaId]
    );

    if (!rows[0]) {

        const error = new Error(
            "Cliente não encontrado."
        );

        error.statusCode = 404;

        throw error;

    }

    return rows[0];

}

/* ==================================================
   VALIDAR ENDEREÇO
================================================== */

function verificarEndereco(cliente) {

    return CAMPOS_ENDERECO_OBRIGATORIOS
        .filter(({ campo }) => {

            const valor = cliente[campo];

            return (
                valor === null ||
                valor === undefined ||
                String(valor).trim() === ""
            );

        })
        .map(({ nome }) => nome);

}

/* ==================================================
   BUSCAR DETALHES DOS ITENS
================================================== */

async function getItensDetalhados(
    itens,
    empresaId
) {

    if (!Array.isArray(itens) || itens.length === 0) {
        return [];
    }

    const ids = [
        ...new Set(
            itens
                .map(item => item.produto_id)
                .filter(Boolean)
        )
    ];

    if (ids.length === 0) {
        return [];
    }

    const { rows } = await db.query(
        `
            SELECT
                id,
                nome
            FROM produtos
            WHERE id = ANY($1::uuid[])
              AND empresa_id = $2;
        `,
        [
            ids,
            empresaId
        ]
    );

    const produtosPorId = new Map(
        rows.map(produto => [
            produto.id,
            produto
        ])
    );

    return itens.map(item => {

        const produto =
            produtosPorId.get(item.produto_id);

        return {
            nome: produto?.nome ?? "Produto",

            quantidade: Number(
                item.quantidade ?? 0
            ),

            valor_unitario: Number(
                item.preco_unitario ?? 0
            ),

            preco_unitario: Number(
                item.preco_unitario ?? 0
            ),

            subtotal: Number(
                item.subtotal ?? 0
            )
        };

    });

}

/* ==================================================
   MONTAR OBSERVAÇÕES
================================================== */

function montarObservacoes(
    cliente,
    observacoes
) {

    const endereco = [
        cliente.endereco,
        cliente.numero,
        cliente.complemento,
        cliente.bairro,
        cliente.cidade,
        cliente.estado
    ]
        .filter(valor => {

            return (
                valor !== null &&
                valor !== undefined &&
                String(valor).trim() !== ""
            );

        })
        .map(valor => String(valor).trim())
        .join(", ");

    return [
        "Pedido realizado pela loja pública.",

        `Endereço: ${endereco}`,

        observacoes
            ? `Observações: ${observacoes}`
            : ""
    ]
        .filter(Boolean)
        .join("\n");

}

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = {
    criarPedido
};
