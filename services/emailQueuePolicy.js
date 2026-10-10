"use strict";
// Resend guarda chaves por 24h; a margem impede repetir um resultado incerto fora da janela.
module.exports = { MAX_ATTEMPTS: 8, RETRY_WINDOW_SECONDS: 23 * 60 * 60 };
