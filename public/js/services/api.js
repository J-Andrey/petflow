"use strict";

/* ==================================================
   CONFIGURAÇÃO DA API
================================================== */

const API = {

    baseURL: "/api"

};
/* ==================================================
   REQUISIÇÃO
================================================== */

async function request(endpoint, options = {}) {

    const token = getToken();

    const config = {

        headers: {

            ...(!(options.body instanceof FormData) && { "Content-Type": "application/json" }),

            ...(token && {

                Authorization: `Bearer ${token}`

            })

        },

        ...options

    };

    try {

        const response = await fetch(

            `${API.baseURL}${endpoint}`,

            config

        );

        if (!response.ok) {

            let errorMessage = `Erro ${response.status}`;

            try {

                const error = await response.json();

                errorMessage =
                    error.message ||
                    error.erro ||
                    errorMessage;

            } catch {

                // Resposta sem JSON

            }

            throw new Error(errorMessage);

        }

        if (response.status === 204) {

            return null;

        }

        return await response.json();

    } catch (error) {

        console.error("Erro na API:", error);

        throw error;

    }

}

/* ==================================================
   GET
================================================== */

async function apiGet(endpoint) {

    return request(endpoint);

}

/* ==================================================
   POST
================================================== */

async function apiPost(endpoint, data) {

    return request(endpoint, {

        method: "POST",

        body: data instanceof FormData ? data : JSON.stringify(data)

    });

}

/* ==================================================
   PUT
================================================== */

async function apiPut(endpoint, data) {

    return request(endpoint, {

        method: "PUT",

        body: data instanceof FormData ? data : JSON.stringify(data)

    });

}

/* ==================================================
   PATCH
================================================== */

async function apiPatch(endpoint, data) {

    return request(endpoint, {

        method: "PATCH",

        body: data instanceof FormData ? data : JSON.stringify(data)

    });

}

/* ==================================================
   DELETE
================================================== */

async function apiDelete(endpoint) {

    return request(endpoint, {

        method: "DELETE"

    });

}
