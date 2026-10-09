"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");

    if (!loginForm) {
        return;
    }

    setupPasswordToggles();
    loginForm.addEventListener("submit", handleLogin);
    document.querySelector("[data-admin-forgot-password]")?.addEventListener("click", handleForgotPassword);
});

async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById("email");
    const password = document.getElementById("senha") || document.getElementById("password");

    if (!validateRequired(email, "Informe o e-mail.")) {
        return;
    }

    if (!validateEmail(email)) {
        return;
    }

    if (!password.value) {
        alert("Informe a senha.");
        password.focus();
        return;
    }

    // O login aceita as senhas já existentes; regras de criação são aplicadas no servidor.

    try {
        const response = await AuthService.login({
            email: email.value.trim(),
            senha: password.value
        });

        saveToken(response.data.token);
        saveUser(response.data.user);

        window.location.href = "/admin/pages/dashboard/dashboard.html";
    } catch (error) {
        alert(error.message || "Erro ao realizar login.");
    }
}

function handleForgotPassword(event) {
    event.preventDefault();

    const email = document.getElementById("email")?.value?.trim();

    if (!email) {
        alert("Informe seu e-mail no campo de login para receber a recuperação de senha.");
        return;
    }

    fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
    })
        .then(async response => {
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload.message || "Não foi possível enviar a recuperação.");
            }

            alert(payload.message || "Verifique seu e-mail.");
        })
        .catch(error => {
            alert(error.message || "Não foi possível enviar a recuperação.");
        });
}

function setupPasswordToggles() {
    document.querySelectorAll("input[type='password']").forEach(input => {
        if (input.closest(".password-control")) {
            return;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "password-control";
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const button = document.createElement("button");
        button.className = "password-toggle";
        button.type = "button";
        button.setAttribute("aria-label", "Mostrar senha");
        button.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';

        button.addEventListener("click", () => {
            const visible = input.type === "text";
            input.type = visible ? "password" : "text";
            button.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
            button.innerHTML = visible
                ? '<i class="fa-regular fa-eye-slash"></i>'
                : '<i class="fa-regular fa-eye"></i>';
        });

        wrapper.appendChild(button);
    });
}
