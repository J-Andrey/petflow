"use strict";

/* ==================================================
   DEPENDÊNCIAS
================================================== */

require("dotenv").config();

const express = require("express");

const path = require("path");

/* ==================================================
   MIDDLEWARES
================================================== */

const securityMiddleware = require("./middlewares/securityMiddleware");

const errorMiddleware = require("./middlewares/errorMiddleware");

/* ==================================================
   ROTAS
================================================== */

const authRoutes = require("./routes/authRoutes");

const clienteRoutes = require("./routes/clienteRoutes");

const petRoutes = require("./routes/petRoutes");

const agendamentoRoutes = require("./routes/agendamentoRoutes");

const funcionarioRoutes = require("./routes/funcionarioRoutes");

const empresaRoutes = require("./routes/empresaRoutes");

const categoriaRoutes = require("./routes/categoriaRoutes");

const produtoRoutes = require("./routes/produtoRoutes");

const estoqueRoutes = require("./routes/estoqueRoutes");

const vendaRoutes = require("./routes/vendaRoutes");

const itemVendaRoutes = require("./routes/itemVendaRoutes");

const servicoRoutes = require("./routes/servicoRoutes");

const fornecedorRoutes = require("./routes/fornecedorRoutes");

const compraRoutes = require("./routes/compraRoutes");

const itemCompraRoutes = require("./routes/itemCompraRoutes");

const financeiroRoutes = require("./routes/financeiroRoutes");

const publicCatalogRoutes = require("./routes/publicCatalogRoutes");

const publicPaymentRoutes = require("./routes/publicPaymentRoutes");

/* ==========================
   DASHBOARD
========================== */

const dashboardRoutes = require("./routes/dashboardRoutes");

/* ==================================================
   APP
================================================== */

const app = express();
app.get("/api/health", (req,res) => res.set("Cache-Control","no-store").json({success:true,status:"alive"}));
app.get("/api/readiness", async (req,res) => {
    try {
        const ready=await require("./services/healthService").readiness(require("./database/connection"));
        res.set("Cache-Control","no-store").status(ready?200:503).json({success:ready,status:ready?"ready":"not_ready"});
    } catch { res.status(503).json({success:false,status:"not_ready"}); }
});

app.set("trust proxy", 1);

/* ==================================================
   SEGURANÇA
================================================== */

securityMiddleware(app);

/* ==================================================
   MIDDLEWARES NATIVOS
================================================== */

app.use(express.json({
    verify: (request, response, buffer, encoding) => {
        const isPagSeguroWebhook =
            request.originalUrl?.split("?")[0] ===
            "/api/public/pagamentos/webhook";

        if (isPagSeguroWebhook) {
            request.rawBody = buffer.toString(encoding || "utf8");
        }
    }
}));

app.use(express.urlencoded({

    extended: true

}));

/* ==================================================
   ARQUIVOS ESTÁTICOS
================================================== */

app.use(express.static(path.join(__dirname, "public")));

app.use("/admin", express.static(path.join(__dirname, "admin")));

/* ==================================================
   ROTA INICIAL
================================================== */

app.get("/", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "home", "index.html"));

});

app.get("/login", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "auth", "login.html"));

});

app.get("/redefinir-senha", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "auth", "reset-password.html"));

});

app.get("/conta", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "auth", "account.html"));

});

app.get("/meus-pedidos", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "auth", "orders.html"));

});

app.get("/meus-pets", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "auth", "pets.html"));

});

app.get("/sacola", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "cart", "index.html"));

});

app.get("/politica-de-privacidade", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "legal", "privacy.html"));

});

app.get("/termos-de-uso", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "legal", "terms.html"));

});

app.get("/newsletter/cancelar", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "newsletter", "unsubscribe.html"));

});

app.get("/categorias/:slug", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "categories", "detail.html"));

});

app.get("/produtos/:slug", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "products", "detail.html"));

});

app.get("/servicos/:slug", (request, response) => {

    response.sendFile(path.join(__dirname, "views", "services", "detail.html"));

});

app.get("/api", (request, response) => {

    response.status(200).json({

        success: true,

        message: "Bem-vindo a API do PetFlow."

    });

});

/* ==================================================
   ROTAS API
================================================== */

app.use("/api/auth", authRoutes);

app.use("/api/public/pagamentos", publicPaymentRoutes);
app.use("/api/entregas", require("./routes/trackingRoutes"));
app.use("/api/cancelamentos", require("./routes/cancellationRoutes"));
app.use("/api/public", require("./routes/deliveryRoutes"));
app.use("/api/public/clientes/direitos", require("./routes/customerRightsRoutes"));

app.use("/api/public", publicCatalogRoutes);

app.use("/api/clientes", clienteRoutes);

app.use("/api/pets", petRoutes);

app.use("/api/agendamentos", agendamentoRoutes);

app.use("/api/funcionarios", funcionarioRoutes);

app.use("/api/empresa", empresaRoutes);

app.use("/api/categorias", categoriaRoutes);

app.use("/api/produtos", produtoRoutes);

app.use("/api/estoque", estoqueRoutes);

app.use("/api/vendas", vendaRoutes);

app.use("/api/itens-venda", itemVendaRoutes);

app.use("/api/servicos", servicoRoutes);

app.use("/api/fornecedores", fornecedorRoutes);

app.use("/api/compras", compraRoutes);

app.use("/api/itens-compra", itemCompraRoutes);

app.use("/api/financeiro", financeiroRoutes);

/* ==========================
   DASHBOARD
========================== */

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/clinica", require("./routes/clinicalRoutes"));
app.use("/api/admin", require("./routes/reconciliationRoutes"));
app.use("/api", require("./routes/professionalRoutes"));

/* ==================================================
   ROTA NÃO ENCONTRADA
================================================== */

app.use((request, response) => {

    response.status(404).json({

        success: false,

        message: "Rota não encontrada."

    });

});

/* ==================================================
   MIDDLEWARE DE ERRO
================================================== */

app.use(errorMiddleware);

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = app;
