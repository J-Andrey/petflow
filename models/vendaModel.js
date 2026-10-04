"use strict";

/* ==================================================
   DEPENDÊNCIAS
================================================== */

const db = require("../database/connection");

/* ==================================================
   MODEL
================================================== */

class VendaModel {

    /* ==========================
       LISTAR PEDIDOS
    ========================== */

    static async listar(empresaId) {

        const query = `
            SELECT
                v.id,
                v.cliente_id,
                c.nome AS cliente_nome,
                c.telefone AS cliente_telefone,
                c.whatsapp AS cliente_whatsapp,
                v.valor_total,
                v.desconto,
                v.acrescimo,
                v.valor_final,
                CASE
                    WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'CREDIT_CARD'
                        THEN 'CARTAO_CREDITO'
                    WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'DEBIT_CARD'
                        THEN 'CARTAO_DEBITO'
                    WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'PIX'
                        THEN 'PIX'
                    ELSE v.forma_pagamento
                END AS forma_pagamento,
                v.status,
                v.data_venda,
                COUNT(iv.id)::INTEGER AS quantidade_itens
            FROM vendas v
            LEFT JOIN clientes c
                ON c.id = v.cliente_id
               AND c.empresa_id = v.empresa_id
            LEFT JOIN itens_venda iv
                ON iv.venda_id = v.id
               AND iv.empresa_id = v.empresa_id
            WHERE v.empresa_id = $1
            GROUP BY
                v.id,
                c.id,
                c.nome,
                c.telefone,
                c.whatsapp
            ORDER BY v.data_venda DESC;
        `;

        const { rows } = await db.query(query, [empresaId]);

        return rows;

    }

    /* ==========================
       BUSCAR PEDIDO POR ID
    ========================== */

    static async buscarPorId(id, empresaId) {

        const query = `
            SELECT
                v.id,
                v.cliente_id,
                v.usuario_id,
                v.empresa_id,
                v.reserva_expira_em,
                v.endereco_entrega,
                v.valor_frete,
                v.cupom_codigo,
                v.data_venda,
                v.valor_total,
                v.desconto,
                v.acrescimo,
                v.valor_final,
                CASE
                    WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'CREDIT_CARD'
                        THEN 'CARTAO_CREDITO'
                    WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'DEBIT_CARD'
                        THEN 'CARTAO_DEBITO'
                    WHEN v.pagseguro_response #>> '{charges,0,payment_method,type}' = 'PIX'
                        THEN 'PIX'
                    ELSE v.forma_pagamento
                END AS forma_pagamento,
                v.status,
                v.pagseguro_checkout_id,
                v.pagseguro_order_id,
                v.pagseguro_charge_id,
                v.pagseguro_status,
                v.pagseguro_checkout_url,
                v.pagseguro_qr_code,
                v.pagseguro_qr_code_text,
                v.pagamento_atualizado_em,
                v.observacoes,
                v.created_at,
                v.updated_at,
                CASE
                    WHEN c.id IS NULL THEN NULL
                    ELSE jsonb_build_object(
                        'id', c.id,
                        'nome', c.nome,
                        'cpf', c.cpf,
                        'email', c.email,
                        'telefone', c.telefone,
                        'whatsapp', c.whatsapp,
                        'cep', c.cep,
                        'endereco', c.endereco,
                        'numero', c.numero,
                        'complemento', c.complemento,
                        'bairro', c.bairro,
                        'cidade', c.cidade,
                        'estado', c.estado
                    )
                END AS cliente,
                COALESCE(itens.itens, '[]'::jsonb) AS itens
            FROM vendas v
            LEFT JOIN clientes c
                ON c.id = v.cliente_id
               AND c.empresa_id = v.empresa_id
            LEFT JOIN LATERAL (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', iv.id,
                        'produto_id', iv.produto_id,
                        'produto', p.nome,
                        'quantidade', iv.quantidade,
                        'preco_unitario', iv.preco_unitario,
                        'desconto', iv.desconto,
                        'subtotal', iv.subtotal
                    )
                    ORDER BY iv.created_at ASC, iv.id ASC
                ) AS itens
                FROM itens_venda iv
                INNER JOIN produtos p
                    ON p.id = iv.produto_id
                   AND p.empresa_id = v.empresa_id
                WHERE iv.venda_id = v.id
                  AND iv.empresa_id = v.empresa_id
            ) itens ON TRUE
            WHERE v.id = $1
              AND v.empresa_id = $2
            LIMIT 1;
        `;

        const { rows } = await db.query(query, [
            id,
            empresaId
        ]);

        return rows[0];

    }

    /* ==========================
       BUSCAR PEDIDO DO CLIENTE
    ========================== */

    static async buscarPorIdDoCliente(
        id,
        clienteId,
        empresaId
    ) {

        const pedido = await this.buscarPorId(
            id,
            empresaId
        );

        if (
            !pedido ||
            String(pedido.cliente_id) !== String(clienteId)
        ) {
            return null;
        }

        return pedido;

    }

    /* ==========================
       CADASTRAR
    ========================== */

    static async criar(dados, client = db) {

        const query = `
            INSERT INTO vendas (
                empresa_id,
                cliente_id,
                usuario_id,
                data_venda,
                valor_total,
                desconto,
                acrescimo,
                valor_final,
                forma_pagamento,
                status,
                observacoes
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11
            )
            RETURNING *;
        `;

        const valorTotal = Number(
            dados.valorTotal ?? dados.valor_total ?? 0
        );

        const desconto = Number(dados.desconto ?? 0);
        const acrescimo = Number(dados.acrescimo ?? 0);
        const valorFinal = valorTotal - desconto + acrescimo;

        const values = [
            dados.empresaId ?? dados.empresa_id,
            dados.clienteId ?? dados.cliente_id ?? null,
            dados.usuarioId ?? dados.usuario_id ?? null,
            dados.dataVenda ?? dados.data_venda ?? new Date(),
            valorTotal,
            desconto,
            acrescimo,
            valorFinal,
            dados.formaPagamento ??
                dados.forma_pagamento ??
                "PIX",
            dados.status ?? "PENDENTE",
            dados.observacoes?.trim() || null
        ];

        const { rows } = await client.query(query, values);

        return rows[0];

    }

    /* ==========================
       ATUALIZAR STATUS
    ========================== */

    static async atualizarStatus(
        id,
        empresaId,
        status,
        client = db
    ) {

        const query = `
            UPDATE vendas
            SET
                status = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
              AND empresa_id = $3
            RETURNING *;
        `;

        const values = [
            status,
            id,
            empresaId
        ];

        const { rows } = await client.query(query, values);

        return rows[0];

    }

    /* ==========================
       REGISTRAR PAGAMENTO EXTERNO
    ========================== */

    static async registrarPagamentoPagSeguro(
        id,
        empresaId,
        dados,
        client = db
    ) {

        const query = `
            UPDATE vendas
            SET
                pagseguro_checkout_id = COALESCE($1, pagseguro_checkout_id),
                pagseguro_order_id = COALESCE($2, pagseguro_order_id),
                pagseguro_charge_id = COALESCE($3, pagseguro_charge_id),
                pagseguro_status = COALESCE($4, pagseguro_status),
                pagseguro_checkout_url = COALESCE($5, pagseguro_checkout_url),
                pagseguro_qr_code = COALESCE($6, pagseguro_qr_code),
                pagseguro_qr_code_text = COALESCE($7, pagseguro_qr_code_text),
                pagseguro_response = COALESCE($8::jsonb, pagseguro_response),
                forma_pagamento = COALESCE($9, forma_pagamento),
                pagamento_atualizado_em = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $10
              AND empresa_id = $11
            RETURNING *;
        `;

        const values = [
            dados.pagseguroCheckoutId ?? dados.pagseguro_checkout_id ?? null,
            dados.pagseguroOrderId ?? dados.pagseguro_order_id ?? null,
            dados.pagseguroChargeId ?? dados.pagseguro_charge_id ?? null,
            dados.pagseguroStatus ?? dados.pagseguro_status ?? null,
            dados.pagseguroCheckoutUrl ?? dados.pagseguro_checkout_url ?? null,
            dados.pagseguroQrCode ?? dados.pagseguro_qr_code ?? null,
            dados.pagseguroQrCodeText ?? dados.pagseguro_qr_code_text ?? null,
            dados.pagseguroResponse ?? dados.pagseguro_response ?? null,
            dados.formaPagamento ?? dados.forma_pagamento ?? null,
            id,
            empresaId
        ];

        const { rows } = await client.query(query, values);

        return rows[0];

    }

    /* ==========================
       ATUALIZAR PAGAMENTO POR CHECKOUT
    ========================== */

    static async atualizarPagamentoPorReferencia(
        referencia,
        dados,
        client = db
    ) {

        const vendaAtual = await this.buscarPorReferenciaPagamento(
            referencia,
            client
        );

        if (!vendaAtual) {
            return null;
        }

        const status = resolvePaymentStatus(
            vendaAtual.status,
            dados.status
        );

        const pagseguroStatus =
            dados.pagseguroStatus ?? dados.pagseguro_status ?? null;

        const pagseguroOrderId =
            dados.pagseguroOrderId ?? dados.pagseguro_order_id ?? null;

        const pagseguroChargeId =
            dados.pagseguroChargeId ?? dados.pagseguro_charge_id ?? null;

        if (
            String(vendaAtual.status || "") === String(status || "") &&
            String(vendaAtual.pagseguro_status || "") === String(pagseguroStatus || "") &&
            String(vendaAtual.pagseguro_order_id || "") === String(pagseguroOrderId || "") &&
            String(vendaAtual.pagseguro_charge_id || "") === String(pagseguroChargeId || "")
        ) {
            return vendaAtual;
        }

        const query = `
            UPDATE vendas
            SET
                status = COALESCE($1, status),
                pagseguro_status = COALESCE($2, pagseguro_status),
                pagseguro_order_id = COALESCE($3, pagseguro_order_id),
                pagseguro_charge_id = COALESCE($4, pagseguro_charge_id),
                pagseguro_response = COALESCE($5::jsonb, pagseguro_response),
                forma_pagamento = COALESCE($6, forma_pagamento),
                pagamento_atualizado_em = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
            RETURNING *;
        `;

        const values = [
            status,
            pagseguroStatus,
            pagseguroOrderId,
            pagseguroChargeId,
            dados.pagseguroResponse ?? dados.pagseguro_response ?? null,
            dados.formaPagamento ?? dados.forma_pagamento ?? null,
            vendaAtual.id
        ];

        const { rows } = await client.query(query, values);

        return rows[0];

    }

    /* ==========================
       BUSCAR PAGAMENTO POR REFERENCIA
    ========================== */

    static async buscarPorReferenciaPagamento(
        referencia,
        client = db
    ) {

        const query = `
            SELECT *
            FROM vendas
            WHERE
                id::TEXT = $1
                OR pagseguro_checkout_id = $1
                OR pagseguro_order_id = $1
                OR pagseguro_charge_id = $1
            LIMIT 1;
        `;

        const { rows } = await client.query(query, [
            String(referencia || "")
        ]);

        return rows[0] || null;

    }

    /* ==========================
       ATUALIZAR VALOR TOTAL
    ========================== */

    static async atualizarValorTotal(
        id,
        valorTotal,
        client = db
    ) {

        const query = `
            UPDATE vendas
            SET
                valor_total = $1,
                valor_final = $1 - desconto + acrescimo,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *;
        `;

        const { rows } = await client.query(query, [
            valorTotal,
            id
        ]);

        return rows[0];

    }

    /* ==========================
       TOTAL DE VENDAS
    ========================== */

    static async totalVendas(empresaId) {

        const query = `
            SELECT
                COUNT(*) AS quantidade,
                COALESCE(SUM(valor_final), 0) AS total
            FROM vendas
            WHERE empresa_id = $1;
        `;

        const { rows } = await db.query(query, [
            empresaId
        ]);

        return rows[0];

    }

}

function resolvePaymentStatus(currentStatus, nextStatus) {
    if (!nextStatus) {
        return currentStatus;
    }

    if (
        currentStatus === "PAGAMENTO_APROVADO" &&
        nextStatus === "AGUARDANDO_PAGAMENTO"
    ) {
        return currentStatus;
    }

    return nextStatus;
}

module.exports = VendaModel;
