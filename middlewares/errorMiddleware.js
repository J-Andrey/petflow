"use strict";
module.exports = function errorMiddleware(error,request,response,next) {
    if(response.headersSent) return next(error);
    const code = String(error.code || "");
    const known = { "23505": [409,"Dados já cadastrados."], "23503": [409,"O registro está vinculado a outros dados."],
        "23514": [400,"Os dados não atendem às regras do sistema."], "22P02": [400,"Identificador ou valor inválido."],
        "LIMIT_FILE_SIZE": [413,"Imagem maior que o limite permitido."] };
    const mapped=known[code];
    const candidate=Number(error.status||error.statusCode||500);
    const status=mapped?.[0] || (candidate>=400 && candidate<=599 ? candidate : 500);
    console.error("[request]", {status,code:/^[A-Z0-9_]{1,40}$/.test(code)?code:"ERROR"});
    return response.status(status).json({success:false,message:mapped?.[1] || (status<500 ? error.message : "Não foi possível concluir a operação. Tente novamente mais tarde.")});
};
