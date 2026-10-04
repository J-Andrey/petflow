"use strict";

/* ==================================================
   DEPENDÊNCIAS
================================================== */

const db = require("../database/connection");
const rules = require("./orderRules");
const reservations = require("./reservationService");

const VendaModel = require("../models/vendaModel");
const ItemVendaModel = require("../models/itemVendaModel");

const MovimentacaoEstoqueService = require(
    "./movimentacaoEstoqueService"
);

const FinanceiroService = require("./financeiroService");

const {
    sendOptionalEmail,
    paymentApprovedTemplate,
    orderOutForDeliveryTemplate,
    orderDeliveredTemplate,
    orderCanceledTemplate
} = require("./emailService");

/* ==================================================
   FORMAS DE PAGAMENTO ACEITAS
================================================== */

const FORMAS_PAGAMENTO = [
    "PIX",
    "CARTAO_CREDITO",
    "CARTAO_DEBITO",
    "PAGBANK"
];

/* ==================================================
   SERVICE
================================================== */

const VendaService = {

    /* ==============================================
       FINALIZAR VENDA
    ============================================== */

    async finalizarVenda(empresaId, venda, itens) {
        itens = rules.normalizeItems(itens);

        if (!empresaId) {
            throw new Error("Empresa não informada.");
        }

        if (!venda || typeof venda !== "object") {
            throw new Error("Dados da venda não informados.");
        }

        if (!Array.isArray(itens) || itens.length === 0) {
            throw new Error(
                "A venda deve possuir pelo menos um item."
            );
        }

        const formaPagamento =
            venda.forma_pagamento ??
            venda.formaPagamento ??
            "PIX";

        if (!FORMAS_PAGAMENTO.includes(formaPagamento)) {
            throw new Error("Forma de pagamento inválida.");
        }

        const desconto = 0;
        const acrescimo = 0;

        if (
            !Number.isFinite(desconto) ||
            desconto < 0
        ) {
            throw new Error("Desconto inválido.");
        }

        if (
            !Number.isFinite(acrescimo) ||
            acrescimo < 0
        ) {
            throw new Error("Acréscimo inválido.");
        }

        const client = await db.connect();

        try {

            await client.query("BEGIN");

            const novaVenda = await VendaModel.criar(
                {
                    empresa_id: empresaId,

                    cliente_id:
                        venda.cliente_id ??
                        venda.clienteId ??
                        null,

                    usuario_id:
                        venda.usuario_id ??
                        venda.usuarioId ??
                        null,

                    data_venda:
                        venda.data_venda ??
                        venda.dataVenda ??
                        new Date(),

                    forma_pagamento: formaPagamento,

                    status: "AGUARDANDO_PAGAMENTO",

                    desconto,

                    acrescimo,

                    observacoes:
                        venda.observacoes ?? null,

                    valor_total: 0
                },
                client
            );

            const expiresAt = new Date(Date.now() + rules.reservationMinutes() * 60000);
            await client.query("UPDATE vendas SET reserva_expira_em=$1 WHERE id=$2 AND empresa_id=$3",
                [expiresAt,novaVenda.id,empresaId]);
            let valorTotalBruto = 0;

            const itensCriados = [];

            for (const item of itens) {

                const produtoId =
                    item.produto_id ??
                    item.produtoId;

                const quantidade = Number(
                    item.quantidade
                );

                if (!produtoId) {
                    throw new Error(
                        "Produto não informado."
                    );
                }

                if (
                    !Number.isInteger(quantidade) ||
                    quantidade <= 0
                ) {
                    throw new Error(
                        "A quantidade do produto deve ser um número inteiro maior que zero."
                    );
                }

                /*
                ==========================================
                 BUSCA O PREÇO VERDADEIRO NO BANCO

                 O valor enviado pelo navegador é ignorado.
                ==========================================
                */

                const { rows } = await client.query(
                    `
                        SELECT
                            id,
                            nome,
                            preco
                        FROM produtos
                        WHERE id = $1
                          AND empresa_id = $2
                          AND ativo = TRUE
                        LIMIT 1
                        FOR UPDATE;
                    `,
                    [
                        produtoId,
                        empresaId
                    ]
                );

                const produto = rows[0];

                if (!produto) {
                    throw new Error(
                        "Produto não encontrado ou indisponível."
                    );
                }

                const precoUnitario = Number(
                    produto.preco
                );

                if (
                    !Number.isFinite(precoUnitario) ||
                    precoUnitario < 0
                ) {
                    throw new Error(
                        `O produto ${produto.nome} possui um preço inválido.`
                    );
                }

                const stock=await client.query("SELECT quantidade FROM estoque WHERE empresa_id=$1 AND produto_id=$2 FOR UPDATE",[empresaId,produtoId]);
                const reserved=await client.query("SELECT COALESCE(SUM(quantidade),0)::integer AS quantidade FROM reservas_estoque WHERE empresa_id=$1 AND produto_id=$2 AND confirmada_em IS NULL AND liberada_em IS NULL",[empresaId,produtoId]);
                if (!stock.rows[0] || Number(stock.rows[0].quantidade)-Number(reserved.rows[0].quantidade)<quantidade)
                    throw Object.assign(new Error("Estoque insuficiente para "+produto.nome),{status:409});
                await client.query("INSERT INTO reservas_estoque(empresa_id,venda_id,produto_id,quantidade,expira_em) VALUES($1,$2,$3,$4,$5)",
                    [empresaId,novaVenda.id,produtoId,quantidade,expiresAt]);
                const descontoItem = 0;

                const subtotal =
                    quantidade * Math.round(precoUnitario * 100) / 100 -
                    descontoItem;

                const novoItem =
                    await ItemVendaModel.criar(
                        {
                            venda_id: novaVenda.id,
                            produto_id: produtoId,
                            quantidade,
                            preco_unitario:
                                precoUnitario,
                            desconto: descontoItem,
                            subtotal
                        },
                        client
                    );

                itensCriados.push(novoItem);

                valorTotalBruto = Math.round((valorTotalBruto + subtotal) * 100) / 100;

            }

            const valorFinal =
                valorTotalBruto -
                desconto +
                acrescimo;

            if (valorFinal < 0) {
                throw new Error(
                    "O desconto não pode ser maior que o valor da venda somado ao acréscimo."
                );
            }

            /*
            ==========================================
             ATUALIZA OS TOTAIS

             O model recebe o total bruto.
             Ele calcula:
             valor_final = valor_total - desconto
                           + acréscimo
            ==========================================
            */

            const vendaAtualizada =
                await VendaModel.atualizarValorTotal(
                    novaVenda.id,
                    valorTotalBruto,
                    client
                );

            await client.query("COMMIT");

            return {
                success: true,

                message:
                    "Venda finalizada com sucesso.",

                venda: vendaAtualizada,

                itens: itensCriados
            };

        } catch (error) {

            await client.query("ROLLBACK");

            throw error;

        } finally {

            client.release();

        }

    },

    /* ==============================================
       CONFIRMAR PAGAMENTO
    ============================================== */

    async confirmarPagamento(empresaId, referencia, dadosPagamento = {}) {

        const client = await db.connect();

        try {

            await client.query("BEGIN");

            const venda = await buscarVendaPagamento(
                referencia,
                empresaId,
                client
            );

            if (!venda) {
                await client.query("COMMIT");
                return null;
            }

            let shouldNotifyPayment = false;

            if (venda.estoque_baixado_em) {
                await VendaModel.atualizarPagamentoPorReferencia(
                    referencia,
                    {
                        ...dadosPagamento,
                        status: venda.status
                    },
                    client
                );

                await client.query("COMMIT");
                return venda;
            }

            if (venda.status === "CANCELADA") {
                // Pagamento tardio exige conciliação: não ressuscitar pedido sem estoque.
                await client.query("INSERT INTO notificacoes_admin(empresa_id,venda_id,titulo,mensagem) SELECT $1,$2,'Pagamento após cancelamento','Conferir no PagBank e tratar reembolso.' WHERE NOT EXISTS (SELECT 1 FROM notificacoes_admin WHERE venda_id=$2 AND titulo='Pagamento após cancelamento')",[venda.empresa_id,venda.id]);
                await client.query("COMMIT");
                return venda;
            }
            shouldNotifyPayment = true;
            await client.query("SELECT set_config('petflow.referencia_tipo','VENDA',TRUE),set_config('petflow.referencia_id',$1,TRUE)",[venda.id]);
            // Confirmar a reserva antes de baixar o saldo; rollback reverte os dois.
            await client.query("UPDATE reservas_estoque SET confirmada_em=NOW() WHERE venda_id=$1 AND empresa_id=$2 AND confirmada_em IS NULL AND liberada_em IS NULL",[venda.id,venda.empresa_id]);

            const itens = await listarItensVenda(
                venda.id,
                venda.empresa_id,
                client
            );

            for (const item of itens) {
                await MovimentacaoEstoqueService.saida(
                    venda.empresa_id,
                    item.produto_id,
                    item.quantidade,
                    client
                );
            }

            const vendaAtualizada =
                await VendaModel.atualizarPagamentoPorReferencia(
                    referencia,
                    {
                        status: "PAGAMENTO_APROVADO",
                        ...dadosPagamento
                    },
                    client
                );

            await client.query("UPDATE vendas SET estoque_baixado_em=NOW() WHERE id=$1 AND empresa_id=$2 AND estoque_baixado_em IS NULL",[venda.id,venda.empresa_id]);
            await gerarFinanceiroSeNaoExistir(
                venda.empresa_id,
                vendaAtualizada || venda,
                client
            );

            await client.query("COMMIT");

            if (shouldNotifyPayment) {
                await enviarEmailStatusPedido(
                    vendaAtualizada || venda,
                    "PAGAMENTO_APROVADO"
                ).catch(()=>console.warn("[email] confirmação de pagamento não enviada"));
            }

            return vendaAtualizada || venda;

        } catch (error) {

            await client.query("ROLLBACK");
            throw error;

        } finally {

            client.release();

        }

    },

    /* ==============================================
       ATUALIZAR STATUS DO PEDIDO
    ============================================== */

    async atualizarStatusPedido(empresaId,vendaId,status,actor) {
        const changed=await db.transaction(async client=>{
            const current=await buscarVendaPagamento(vendaId,empresaId,client);
            if(!current) return null;
            rules.assertTransition(current.status,status);
            if(current.status===status) return current;
            if(status==="CANCELADA") await reservations.release(client,current);
            const updated=await VendaModel.atualizarStatus(vendaId,empresaId,status,client);
            if(actor) await require("./auditService").record(client,actor,"STATUS","vendas",vendaId,current,updated);
            return updated;
        });
        if(changed) await enviarEmailStatusPedido(changed,status).catch(()=>console.warn("[email] atualização de pedido não enviada"));
        return changed;
    },

    /* ==============================================
       ATUALIZAR STATUS DO PAGAMENTO
    ============================================== */

    async atualizarStatusPagamento(empresaId,referencia,status,dadosPagamento={}) {
        return db.transaction(async client=>{
            const current=await buscarVendaPagamento(referencia,empresaId,client);
            if(!current) return null;
            // Eventos antigos não desfazem pagamento, entrega ou cancelamento.
            if(current.estoque_baixado_em || current.status==="CANCELADA") return current;
            if(status==="CANCELADA") await reservations.release(client,current);
            return VendaModel.atualizarPagamentoPorReferencia(referencia,{...dadosPagamento,status},client);
        });
    }

};

async function buscarVendaPagamento(referencia, empresaId, client) {

    const { rows } = await client.query(
        `
            SELECT *
            FROM vendas
            WHERE
                (
                    id::TEXT = $1
                    OR pagseguro_checkout_id = $1
                    OR pagseguro_order_id = $1
                    OR pagseguro_charge_id = $1
                )
                AND (
                    $2::uuid IS NULL
                    OR empresa_id = $2
                )
            LIMIT 1
            FOR UPDATE;
        `,
        [
            String(referencia || ""),
            empresaId || null
        ]
    );

    return rows[0] || null;

}

async function listarItensVenda(vendaId, empresaId, client) {

    const { rows } = await client.query(
        `
            SELECT
                iv.produto_id,
                iv.quantidade
            FROM itens_venda iv
            INNER JOIN vendas v
                ON v.id = iv.venda_id
            WHERE iv.venda_id = $1
              AND v.empresa_id = $2 ORDER BY iv.produto_id;
        `,
        [
            vendaId,
            empresaId
        ]
    );

    return rows;

}

async function gerarFinanceiroSeNaoExistir(empresaId, venda, client) {

    const { rows } = await client.query(
        `
            SELECT id
            FROM financeiro
            WHERE empresa_id = $1
              AND origem = 'VENDA'
              AND referencia_id = $2
            LIMIT 1;
        `,
        [
            empresaId,
            venda.id
        ]
    );

    if (rows[0]) {
        return rows[0];
    }

    return FinanceiroService.gerarContaReceber(
        empresaId,
        {
            id: venda.id,
            valor_total: venda.valor_final,
            data_venda: venda.data_venda,
            observacoes: venda.observacoes
        },
        client
    );

}

async function enviarEmailStatusPedido(venda, status) {

    const templateFactory = {
        PAGAMENTO_APROVADO: paymentApprovedTemplate,
        SAIU_PARA_ENTREGA: orderOutForDeliveryTemplate,
        ENTREGUE: orderDeliveredTemplate,
        CANCELADA: orderCanceledTemplate
    }[status];

    if (!templateFactory || !venda?.id || !venda?.empresa_id) {
        return null;
    }

    const pedido = await VendaModel.buscarPorId(
        venda.id,
        venda.empresa_id
    );

    const cliente = pedido?.cliente;

    if (!cliente?.email) {
        return null;
    }

    const template = templateFactory({
        name: cliente.nome,
        orderId: pedido.id,
        total: pedido.valor_final ?? pedido.valor_total
    });

    return sendOptionalEmail({
        to: cliente.email,
        subject: template.subject,
        html: template.html,
        text: template.text
    });

}

module.exports = VendaService;
