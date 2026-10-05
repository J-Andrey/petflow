"use strict";
(() => {
  const token = sessionStorage.getItem("token");
  if (!token) {
    location.href = "/admin/index.html";
    return;
  }
  const $ = (id) => document.getElementById(id);
  let view = "usuarios",
    page = 1,
    records = [];
  const titles = {
    checkouts: "Pagamentos em conferência",
    consultas: "Consultas",
    prontuarios: "Prontuários",
    vacinas: "Vacinas",
    historico_vacinas: "Histórico de vacinas",
    rastreamento: "Rastreamento",
    cupons: "Cupons",
    usuarios: "Usuários",
    auditoria: "Auditoria",
    atendimento: "Atendimento",
    lgpd: "Privacidade",
    notificacoes: "Notificações",
  };
  const columns = {
    checkouts: ["id", "cliente", "status", "criada_em"],
    consultas: ["data_consulta", "pet_id", "motivo_consulta", "status"],
    prontuarios: ["consulta_id", "diagnostico", "retorno"],
    vacinas: ["nome", "fabricante", "intervalo_dias", "ativo"],
    historico_vacinas: [
      "pet_id",
      "vacina_id",
      "data_aplicacao",
      "proxima_dose",
    ],
    rastreamento: ["id", "cliente_nome", "status"],
    cupons: ["codigo", "tipo", "valor", "ativo"],
    usuarios: ["nome", "email", "perfil", "ativo"],
    auditoria: ["created_at", "usuario", "acao", "entidade", "descricao"],
    atendimento: ["protocolo", "tipo", "status", "prazo_em"],
    lgpd: ["protocolo", "tipo", "status", "prazo_em"],
    notificacoes: ["titulo", "mensagem", "enviada_em", "lida_em"],
  };
  const clinical = {
    consultas: [
      ["pet_id", "Pet"],
      ["cliente_id", "Tutor"],
      ["data_consulta", "Data", "date"],
      ["horario", "Horário", "time"],
      ["peso", "Peso", "number", true],
      ["temperatura", "Temperatura", "number", true],
      ["motivo_consulta", "Motivo", "textarea"],
      [
        "status",
        "Status",
        "select",
        false,
        ["AGENDADA", "EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"],
      ],
      ["observacoes", "Observações", "textarea", true],
    ],
    prontuarios: [
      ["consulta_id", "Consulta"],
      ["diagnostico", "Diagnóstico", "textarea"],
      ["tratamento", "Tratamento", "textarea", true],
      ["medicamentos", "Medicamentos", "textarea", true],
      ["receita", "Receita", "textarea", true],
      ["exames_solicitados", "Exames", "textarea", true],
      ["observacoes", "Observações", "textarea", true],
      ["retorno", "Retorno", "date", true],
    ],
    vacinas: [
      ["nome", "Nome"],
      ["fabricante", "Fabricante", "text", true],
      ["descricao", "Descrição", "textarea", true],
      ["intervalo_dias", "Intervalo (dias)", "number", true],
      ["ativo", "Ativa", "select", false, ["true", "false"]],
    ],
    historico_vacinas: [
      ["pet_id", "Pet"],
      ["vacina_id", "Vacina"],
      ["consulta_id", "Consulta", "text", true],
      ["data_aplicacao", "Data da aplicação", "date"],
      ["proxima_dose", "Próxima dose", "date", true],
      ["lote", "Lote", "text", true],
      ["fabricante", "Fabricante", "text", true],
      ["observacoes", "Observações", "textarea", true],
    ],
  };
  const clinicalPath = () => (clinical[view] ? "clinica/" : "");
  async function api(path, method = "GET", data) {
    const result = await fetch("/api/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const body = await result.json();
    if (result.status === 401) {
      sessionStorage.removeItem("token");
      location.href = "/admin/index.html";
    }
    if (!result.ok)
      throw new Error(body.message || "Não foi possível concluir a operação.");
    return body;
  }
  function cell(text, tag = "td") {
    const item = document.createElement(tag);
    item.textContent = text ?? "—";
    return item;
  }
  async function load() {
    $("status").textContent = "Carregando...";
    $("heading").textContent = titles[view];
    $("newUser").hidden =
      !["usuarios", "cupons"].includes(view) && !clinical[view];
    $("newUser").textContent =
      view === "cupons"
        ? "Novo cupom"
        : clinical[view]
          ? "Novo registro"
          : "Novo usuário";
    $("editor").hidden = true;
    try {
      const result =
        view === "rastreamento"
          ? {
              data: (await api("vendas")).filter(
                (item) => item.status === "SAIU_PARA_ENTREGA",
              ),
            }
          : await api(
              clinicalPath() +
                view +
                "?page=" +
                page +
                "&q=" +
                encodeURIComponent($("search").value),
            );
      records = result.data;
      $("head").replaceChildren();
      $("rows").replaceChildren();
      const head = document.createElement("tr");
      columns[view].forEach((key) =>
        head.append(
          cell(
            {
              pet_id: "Pet",
              consulta_id: "Consulta",
              vacina_id: "Vacina",
              data_consulta: "Data",
              historico_vacinas: "Vacinações",
            }[key] || key.replaceAll("_", " "),
            "th",
          ),
        ),
      );
      head.append(cell("Ações", "th"));
      $("head").append(head);
      records.forEach((record) => {
        const row = document.createElement("tr");
        columns[view].forEach((key) => {
          let value = record[key];
          if (key === "pet_id") value = record.pet_nome || value;
          if (key === "consulta_id")
            value = record.consulta_motivo || record.pet_nome || value;
          if (key === "vacina_id") value = record.vacina_nome || value;
          if (typeof value === "boolean") value = value ? "Sim" : "Não";
          else if (
            typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}T/.test(value)
          )
            value = [
              "data_consulta",
              "data_aplicacao",
              "proxima_dose",
              "retorno",
            ].includes(key)
              ? new Date(value).toLocaleDateString("pt-BR")
              : new Date(value).toLocaleString("pt-BR");
          row.append(cell(value));
        });
        const action = cell("");
        const button = document.createElement("button");
        button.textContent = view === "notificacoes" ? "Marcar lida" : "Abrir";
        button.disabled = view === "notificacoes" && !!record.lida_em;
        button.onclick = () => open(record);
        action.append(button);
        row.append(action);
        $("rows").append(row);
      });
      $("unread").textContent =
        result.naoLidas === undefined ? "" : result.naoLidas;
      $("page").textContent = "Página " + page;
      $("previous").disabled = page === 1;
      $("next").disabled = records.length < 25;
      $("status").textContent = records.length
        ? records.length + " registro(s) nesta página."
        : "Nenhum registro encontrado.";
    } catch (error) {
      $("status").textContent = error.message;
      $("rows").replaceChildren();
    }
  }
  function field(name, label, value = "", type = "text", options) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const input = document.createElement(
      options ? "select" : type === "textarea" ? "textarea" : "input",
    );
    input.name = name;
    if (options)
      options.forEach((item) => {
        const option = document.createElement("option");
        option.value = item;
        option.textContent = item;
        input.append(option);
      });
    else input.type = type;
    input.value = value ?? "";
    input.required = true;
    wrapper.append(input);
    $("editorForm").append(wrapper);
    return input;
  }
  async function open(record) {
    if (view === "checkouts") {
      $("editor").hidden = false;
      $("editorForm").replaceChildren();
      $("editorTitle").textContent = "Conferir pagamento";
      const info = document.createElement("p");
      info.textContent =
        "Confira a referência do pedido no painel PagBank. Informe o identificador do checkout já criado para recuperar o vínculo; esta ação não cria cobrança nem aprova pagamento.";
      $("editorForm").append(info);
      field("checkout_id", "Identificador do checkout");
      const save = document.createElement("button");
      save.textContent = "Conferir no PagBank";
      $("editorForm").append(save);
      $("editorForm").onsubmit = async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          await api(
            "checkouts/" + record.id + "/conciliar",
            "POST",
            Object.fromEntries(new FormData(event.target)),
          );
          await load();
          $("status").textContent =
            "Vínculo recuperado. O pagamento continuará sendo confirmado pelo PagBank.";
        } catch (error) {
          $("status").textContent = error.message;
        } finally {
          save.disabled = false;
        }
      };
      return;
    }
    if (view === "rastreamento") {
      $("editor").hidden = false;
      $("editorForm").replaceChildren();
      $("editorTitle").textContent = "Entrega " + record.id;
      const link = document.createElement("a");
      link.href = "/entrega.html?admin=1&pedido=" + record.id;
      link.target = "_blank";
      link.textContent = "Acompanhar entrega";
      $("editorForm").append(link);
      const generate = document.createElement("button");
      generate.type = "button";
      generate.textContent = "Gerar novo link privado";
      generate.onclick = async () => {
        generate.disabled = true;
        try {
          const result = await api(
            "entregas/admin/" + record.id + "/link",
            "POST",
            {},
          );
          const input = document.createElement("input");
          input.readOnly = true;
          input.value = location.origin + result.data.url;
          $("editorForm").append(input);
          input.select();
          $("status").textContent =
            "Copie e envie ao entregador. O link anterior foi revogado; validade de 12 horas.";
        } catch (error) {
          $("status").textContent = error.message;
        } finally {
          generate.disabled = false;
        }
      };
      $("editorForm").append(generate);
      return;
    }
    if (view === "notificacoes") {
      try {
        await api(view + "/" + record.id + "/lida", "PATCH", {});
        await load();
      } catch (error) {
        $("status").textContent = error.message;
      }
      return;
    }
    $("editor").hidden = false;
    $("editorForm").replaceChildren();
    $("editorTitle").textContent =
      record?.protocolo || record?.nome || "Novo usuário";
    if (view === "auditoria") {
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(record, null, 2);
      $("editorForm").append(pre);
      return;
    }
    if (clinical[view]) {
      const relations = {
        pet_id: "pets",
        cliente_id: "clientes",
        consulta_id: "clinica/consultas",
        vacina_id: "clinica/vacinas",
      };
      for (const [
        key,
        label,
        type = "text",
        optional = false,
        options,
      ] of clinical[view]) {
        let value = record?.[key] ?? (key === "ativo" ? "true" : "");
        if (type === "date" && value) value = String(value).slice(0, 10);
        if (type === "time" && value) value = String(value).slice(0, 5);
        if (typeof value === "boolean") value = String(value);
        const input = field(key, label, value, type, options);
        input.required = !optional;
        if (type === "number") input.step = "any";
        if (relations[key]) {
          const select = document.createElement("select");
          select.name = key;
          select.required = !optional;
          const empty = document.createElement("option");
          empty.value = "";
          empty.textContent = "Selecione";
          select.append(empty);
          let relationPage = 1,
            relationQuery = "",
            requestVersion = 0;
          if (value) {
            const chosen = document.createElement("option");
            chosen.value = value;
            chosen.textContent =
              record?.consulta_motivo ||
              record?.vacina_nome ||
              record?.pet_nome ||
              value;
            select.append(chosen);
            select.value = value;
          }
          const more = document.createElement("button");
          more.type = "button";
          more.textContent = "Carregar mais opções";
          more.hidden = true;
          const search = document.createElement("input");
          search.type = "search";
          search.placeholder = "Pesquisar " + label.toLowerCase();
          search.setAttribute("aria-label", "Pesquisar " + label.toLowerCase());
          search.maxLength = 100;
          const paginated = relations[key].startsWith("clinica/");
          async function fetchOptions(reset = false) {
            const version = ++requestVersion;
            more.disabled = true;
            try {
              const result = await api(
                relations[key] +
                  (paginated
                    ? "?page=" +
                      relationPage +
                      "&q=" +
                      encodeURIComponent(relationQuery)
                    : ""),
              );
              if (version !== requestVersion) return;
              const items = result.data || result;
              const chosen = select.selectedOptions[0]?.cloneNode(true);
              if (reset) {
                select.replaceChildren(empty.cloneNode(true));
                if (chosen?.value) select.append(chosen);
              }
              for (const item of items) {
                if (
                  Array.from(select.options).some(
                    (option) => option.value === item.id,
                  )
                )
                  continue;
                const option = document.createElement("option");
                option.value = item.id;
                option.textContent =
                  item.nome ||
                  [item.pet_nome, item.motivo_consulta]
                    .filter(Boolean)
                    .join(" — ") ||
                  item.id;
                select.append(option);
              }
              more.hidden = !paginated || items.length < 25;
            } catch (error) {
              $("status").textContent = error.message;
            } finally {
              more.disabled = false;
            }
          }
          more.onclick = () => {
            relationPage++;
            fetchOptions();
          };
          let searchTimer;
          search.oninput = () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
              relationPage = 1;
              relationQuery = search.value;
              fetchOptions(true);
            }, 300);
          };
          if (paginated) {
            input.parentElement.append(search, more);
          }
          await fetchOptions();
          if (value) select.value = value;
          input.replaceWith(select);
        }
      }
    } else if (view === "cupons") {
      field("codigo", "Código", record?.codigo);
      field("descricao", "Descrição", record?.descricao);
      field("tipo", "Tipo", record?.tipo || "PERCENTUAL", "select", [
        "PERCENTUAL",
        "FIXO",
      ]);
      for (const [key, label] of [
        ["valor", "Valor"],
        ["minimo_compra", "Compra mínima"],
        ["desconto_maximo", "Desconto máximo"],
        ["limite_usos", "Limite total"],
        ["limite_por_cliente", "Limite por cliente"],
      ]) {
        const input = field(
          key,
          label,
          record?.[key] ?? (key === "minimo_compra" ? 0 : ""),
          "number",
        );
        input.step = key.startsWith("limite") ? "1" : "0.01";
        input.min = "0";
        input.required = ["valor", "minimo_compra"].includes(key);
      }
      for (const [key, label] of [
        ["inicia_em", "Início"],
        ["expira_em", "Validade"],
      ]) {
        const date = record?.[key]
          ? new Date(record[key])
          : key === "inicia_em"
            ? new Date()
            : null;
        const local = date
          ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16)
          : "";
        const input = field(key, label, local, "datetime-local");
        input.required = key === "inicia_em";
      }
      field("ativo", "Ativo", String(record?.ativo ?? false), "select", [
        "true",
        "false",
      ]);
      field("publico", "Público", String(record?.publico ?? false), "select", [
        "true",
        "false",
      ]);
    } else if (view === "usuarios") {
      field("nome", "Nome", record?.nome);
      field("email", "E-mail", record?.email, "email");
      field("perfil", "Perfil", record?.perfil || "GERENTE", "select", [
        "ADMIN",
        "GERENTE",
      ]);
      field("ativo", "Ativo", String(record?.ativo ?? true), "select", [
        "true",
        "false",
      ]);
      const password = field(
        "senha",
        record ? "Nova senha (opcional)" : "Senha",
        "",
        "password",
      );
      password.required = !record;
      password.minLength = 8;
      password.maxLength = 72;
      password.autocomplete = "new-password";
    } else {
      const details = document.createElement("p");
      details.textContent = record.detalhes || record.motivo;
      $("editorForm").append(details);
      if (
        view === "lgpd" &&
        ["EXCLUSAO", "ANONIMIZACAO", "REVOGACAO"].includes(record.tipo)
      ) {
        const process = document.createElement("button");
        process.type = "button";
        process.textContent =
          record.tipo === "REVOGACAO"
            ? "Revogar newsletter"
            : "Processar anonimização";
        process.onclick = async () => {
          if (
            !confirm(
              "Confirmar o processamento desta solicitação? A anonimização só será permitida se não houver histórico a preservar.",
            )
          )
            return;
          process.disabled = true;
          try {
            await api("lgpd/" + record.id + "/processar", "POST", {
              confirmacao: "PROCESSAR",
              finalidade:
                record.tipo === "REVOGACAO" ? "NEWSLETTER" : undefined,
            });
            await load();
            $("status").textContent = "Solicitação processada.";
          } catch (error) {
            $("status").textContent = error.message;
          } finally {
            process.disabled = false;
          }
        };
        $("editorForm").append(process);
      }
      if (view === "atendimento" && record.venda_id) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Solicitar cancelamento ou consultar reembolso";
        cancel.onclick = async () => {
          if (
            !confirm(
              "Solicitar o cancelamento deste pedido? Se permitido, o pagamento será estornado no PagBank.",
            )
          )
            return;
          cancel.disabled = true;
          try {
            const result = await api(
              "cancelamentos/admin/" + record.venda_id,
              "POST",
              { motivo: record.motivo },
            );
            $("status").textContent =
              result.data.status === "CANCELADA"
                ? "Pedido cancelado. Responda ao atendimento."
                : result.data.message ||
                  "Solicitação requer análise pelo atendimento.";
          } catch (error) {
            $("status").textContent = error.message;
          } finally {
            cancel.disabled = false;
          }
        };
        $("editorForm").append(cancel);
      }
      field(
        "status",
        "Status",
        record.status,
        "select",
        view === "lgpd"
          ? ["ABERTA", "EM_ANALISE", "ATENDIDA", "NEGADA"]
          : ["RECEBIDA", "EM_ANALISE", "ATENDIDA", "NEGADA"],
      );
      const answer = field(
        "resposta",
        "Resposta ao cliente",
        record.resposta,
        "textarea",
      );
      answer.maxLength = 2000;
      answer.minLength = 5;
    }
    const save = document.createElement("button");
    save.textContent = "Salvar";
    $("editorForm").append(save);
    $("editorForm").onsubmit = async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        const body = Object.fromEntries(new FormData(event.target));
        if (["usuarios", "cupons", "vacinas"].includes(view))
          body.ativo = body.ativo === "true";
        if (view === "cupons") {
          body.publico = body.publico === "true";
          for (const key of [
            "desconto_maximo",
            "limite_usos",
            "limite_por_cliente",
          ])
            body[key] = body[key] === "" ? null : Number(body[key]);
          body.inicia_em = new Date(body.inicia_em).toISOString();
          body.expira_em = body.expira_em
            ? new Date(body.expira_em).toISOString()
            : null;
        }
        await api(
          clinicalPath() + view + (record ? "/" + record.id : ""),
          ["usuarios", "cupons"].includes(view) || clinical[view]
            ? record
              ? "PUT"
              : "POST"
            : "PATCH",
          body,
        );
        await load();
        $("status").textContent = "Dados salvos.";
      } catch (error) {
        $("status").textContent = error.message;
      } finally {
        save.disabled = false;
      }
    };
    $("editor").scrollIntoView({ behavior: "smooth" });
  }
  document.querySelectorAll("[data-view]").forEach(
    (button) =>
      (button.onclick = () => {
        view = button.dataset.view;
        page = 1;
        load();
      }),
  );
  $("searchForm").onsubmit = (event) => {
    event.preventDefault();
    page = 1;
    load();
  };
  $("newUser").onclick = () => open(null);
  $("closeEditor").onclick = () => {
    $("editor").hidden = true;
  };
  $("previous").onclick = () => {
    page--;
    load();
  };
  $("next").onclick = () => {
    page++;
    load();
  };
  load();
})();
