"use strict";

/* ==================================================
   DEPENDÊNCIAS
================================================== */

const helmet = require("helmet");

const cors = require("cors");

const compression = require("compression");

const hpp = require("hpp");

const cookieParser = require("cookie-parser");

const morgan = require("morgan");

const rateLimit = require("express-rate-limit");

/* ==================================================
   RATE LIMIT
================================================== */

const limiter = rateLimit({

    windowMs: 15 * 60 * 1000,

    max: process.env.NODE_ENV === "production" ?100 : 1000,

    standardHeaders: true,

    legacyHeaders: false,

    skip: request =>
        request.method === "OPTIONS" ||
        (
            request.method === "GET" &&
            !request.path.startsWith("/api/")
        ),

    message: {

        success: false,

        message: "Muitas requisições. Tente novamente em alguns minutos."

    }

});

/* ==================================================
   CORS
================================================== */

const allowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.APP_URL
]
    .filter(Boolean)
    .flatMap(origin => origin.split(","))
    .map(origin => origin.trim())
    .filter(Boolean);

const corsOptions = {

    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error("Origem não permitida pelo CORS."));
    },

    credentials: true,

    methods: [

        "GET",

        "POST",

        "PUT",

        "PATCH",

        "DELETE"

    ]

};

/* ==================================================
   SEGURANÇA
================================================== */

function securityMiddleware(app) {

    /* Helmet */

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                "script-src": [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdnjs.cloudflare.com"
                ],
                "style-src": [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdnjs.cloudflare.com"
                ],
                "font-src": [
                    "'self'",
                    "https://cdnjs.cloudflare.com",
                    "data:"
                ],
                "connect-src": [
                    "'self'",
                    "https://viacep.com.br",
                    "https://api.pagseguro.com",
                    "https://sandbox.api.pagseguro.com"
                ]
            }
        }
    }));

    /* Compressão */

    app.use(compression());

    /* Cookie Parser */

    app.use(cookieParser());

    /* HTTP Parameter Pollution */

    app.use(hpp());

    /* CORS */

    app.use(cors(corsOptions));

    /* Logs */

    // Nunca registrar query strings: confirmação e recuperação contêm tokens.
    app.use(morgan((tokens, req, res) =>
        [tokens.method(req, res), req.path, tokens.status(req, res), tokens["response-time"](req, res)].join(" ")));

    /* Rate Limit */

    app.use(limiter);

}

/* ==================================================
   EXPORTAÇÃO
================================================== */

module.exports = securityMiddleware;
