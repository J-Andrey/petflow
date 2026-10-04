"use strict";

(function () {
    const config = window.PetFlowAdminPage;

    if (!config) {
        return;
    }

    const isSalesPage = config.key === "vendas";
    const isSchedulePage = config.key === "agendamentos";
    const isReadOnlyPage = config.readOnly === true;

    let records = [];
    let editingId = null;
    let selectedSaleId = null;
    let scheduleDate = new Date();

    document.addEventListener("DOMContentLoaded", () => {
        if (typeof requireAuth === "function") {
            requireAuth();
        }

        setupAdminNavigation();
        bindPageText();
        setupAdminLogout();
        buildInsights();
        buildPipeline();
        buildScheduleCalendar();
        buildForm();
        applyReadOnlyLayout();
        applySalesLayout();

        if (!isSalesPage) {
            populateRemoteSelects();
        }

        bindEvents();
        loadData();
    });

    function setupAdminNavigation() {
        const sidebar = document.querySelector(".sidebar");
        const topbar = document.querySelector(".topbar");

        if (!sidebar || !topbar || topbar.querySelector(".admin-menu-toggle")) {
            return;
        }

        const title = topbar.querySelector(".topbar-title");
        const left = document.createElement("div");
        left.className = "topbar-left";

        const toggle = document.createElement("button");
        toggle.className = "admin-menu-toggle";
        toggle.type = "button";
        toggle.setAttribute("aria-label", "Abrir menu administrativo");
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = `<i class="fa-solid fa-bars"></i>`;

        left.appendChild(toggle);

        if (title) {
            left.appendChild(title);
        }

        topbar.prepend(left);

        let overlay = document.querySelector(".admin-menu-overlay");

        if (!overlay) {
            overlay = document.createElement("div");
            overlay.className = "admin-menu-overlay";
            document.body.appendChild(overlay);
        }

        function closeSidebar() {
            sidebar.classList.remove("active");
            overlay.classList.remove("active");
            document.body.classList.remove("admin-menu-open");
            toggle.setAttribute("aria-expanded", "false");
        }

        function openSidebar() {
            sidebar.classList.add("active");
            overlay.classList.add("active");
            document.body.classList.add("admin-menu-open");
            toggle.setAttribute("aria-expanded", "true");
        }

        toggle.addEventListener("click", () => {
            if (sidebar.classList.contains("active")) {
                closeSidebar();
                return;
            }

            openSidebar();
        });

        overlay.addEventListener("click", closeSidebar);

        sidebar.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => {
                if (window.innerWidth <= 1024) {
                    closeSidebar();
                }
            });
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeSidebar();
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 1024) {
                closeSidebar();
            }
        });
    }

    function setupAdminLogout() {
        document.querySelectorAll('a[href="/admin/index.html"]').forEach(link => {
            link.addEventListener("click", async event => {
                event.preventDefault();
                try {
                    const response = await fetch("/api/auth/logout",{method:"POST",headers:{Authorization:"Bearer "+sessionStorage.getItem("token")}});
                    if (!response.ok && response.status!==401) throw new Error("Logout");
                } catch { window.alert("Não foi possível encerrar a sessão. Tente novamente."); return; }
                sessionStorage.removeItem("token");
                sessionStorage.removeItem("user");
                localStorage.removeItem("token");
                localStorage.removeItem("user");
                window.location.href="/admin/index.html";
            });
        });
    }

    function bindPageText() {
        setText("moduleTitle", config.title);
        setText("moduleSubtitle", config.subtitle);
        setText("tableTitle", config.tableTitle || config.title);
        setText("formTitle", config.formTitle || "Novo registro");

        const icon = document.getElementById("moduleIcon");

        if (icon) {
            icon.className = `fa-solid ${config.icon || "fa-table"}`;
        }

        document.querySelectorAll("[data-active-page]").forEach(link => {
            if (link.dataset.activePage === config.key) {
                link.classList.add("active");
            }
        });
    }

    function buildInsights() {
        const pageHeader = document.querySelector(".page-header");

        if (
            !pageHeader ||
            !Array.isArray(config.insights) ||
            document.querySelector(".admin-insights")
        ) {
            return;
        }

        const insights = document.createElement("section");
        insights.className = "admin-insights";
        insights.setAttribute("aria-label", "Resumo da página");
        insights.innerHTML = config.insights.map((item, index) => `
            <article
                class="insight-card"
                data-insight-index="${index}"
                data-insight-key="${escapeHtml(item.key || "")}">
                <i class="fa-solid ${escapeHtml(item.icon || "fa-circle-info")}"></i>

                <div>
                    <span>${escapeHtml(item.label || "")}</span>
                    <strong data-insight-value>${escapeHtml(item.value || "0")}</strong>
                    <small data-insight-note>${escapeHtml(item.note || "")}</small>
                </div>
            </article>
        `).join("");

        pageHeader.insertAdjacentElement("afterend", insights);
    }

    function buildPipeline() {
        const insights = document.querySelector(".admin-insights");
        const pageHeader = document.querySelector(".page-header");
        const anchor = insights || pageHeader;

        if (
            !anchor ||
            !Array.isArray(config.pipeline) ||
            document.querySelector(".order-pipeline")
        ) {
            return;
        }

        const pipeline = document.createElement("section");
        pipeline.className = "order-pipeline";
        pipeline.setAttribute("aria-label", "Etapas dos pedidos");
        pipeline.innerHTML = config.pipeline.map((step, index) => `
            <article
                class="pipeline-step"
                data-pipeline-index="${index}"
                data-pipeline-status="${escapeHtml(step.status || "")}">
                <div class="pipeline-icon">
                    <i class="fa-solid ${escapeHtml(step.icon || "fa-circle")}"></i>
                </div>

                <div>
                    <span>Etapa ${index + 1}</span>
                    <strong>${escapeHtml(step.label || "")}</strong>
                    <small>${escapeHtml(step.note || "")}</small>
                </div>

                <b data-pipeline-value>${escapeHtml(step.value || "0")}</b>
            </article>
        `).join("");

        anchor.insertAdjacentElement("afterend", pipeline);
    }

    function buildScheduleCalendar() {
        if (
            !isSchedulePage ||
            !config.calendar ||
            document.querySelector(".schedule-calendar")
        ) {
            return;
        }

        const contentGrid = document.querySelector(".content-grid");
        const anchor = document.querySelector(".admin-insights") ||
            document.querySelector(".page-header");

        if (!contentGrid || !anchor) {
            return;
        }

        const calendar = document.createElement("section");
        calendar.className = "panel schedule-calendar";
        calendar.setAttribute("aria-label", "Calendário de agendamentos");
        calendar.innerHTML = `
            <div class="panel-header schedule-calendar-header">
                <div>
                    <span class="muted">Calendário da loja</span>
                    <h3 id="scheduleCalendarTitle">Agenda</h3>
                </div>

                <div class="schedule-calendar-actions">
                    <button class="btn btn-small" type="button" data-schedule-prev>
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <button class="btn btn-small" type="button" data-schedule-today>Hoje</button>
                    <button class="btn btn-small" type="button" data-schedule-next>
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
            </div>

            <div class="schedule-weekdays">
                ${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
                    .map(day => `<span>${day}</span>`)
                    .join("")}
            </div>

            <div class="schedule-calendar-grid" id="scheduleCalendarGrid"></div>
        `;

        anchor.insertAdjacentElement("afterend", calendar);
        contentGrid.classList.add("content-grid-wide");

        calendar.querySelector("[data-schedule-prev]")?.addEventListener("click", () => {
            scheduleDate = new Date(scheduleDate.getFullYear(), scheduleDate.getMonth() - 1, 1);
            renderScheduleCalendar();
        });

        calendar.querySelector("[data-schedule-next]")?.addEventListener("click", () => {
            scheduleDate = new Date(scheduleDate.getFullYear(), scheduleDate.getMonth() + 1, 1);
            renderScheduleCalendar();
        });

        calendar.querySelector("[data-schedule-today]")?.addEventListener("click", () => {
            scheduleDate = new Date();
            renderScheduleCalendar();
        });
    }

    function buildForm() {
        const form = document.getElementById("recordForm");

        if (!form) {
            return;
        }

        if (isReadOnlyPage) {
            form.innerHTML = "";
            return;
        }

        if (isSalesPage) {
            renderSaleEmptyState(form);
            return;
        }

        const fields = config.fields || [];

        form.innerHTML = fields.map(field => buildFormField(field)).join("") + `
            <div class="form-actions">
                <button
                    type="button"
                    class="btn"
                    id="cancelEdit">
                    Limpar
                </button>

                <button
                    type="submit"
                    class="btn btn-primary">
                    Salvar
                </button>
            </div>
        `;
    }

    function applyReadOnlyLayout() {
        if (!isReadOnlyPage) {
            return;
        }

        const formPanel = document.getElementById("recordForm")?.closest(".panel");
        const contentGrid = document.querySelector(".content-grid");

        formPanel?.remove();
        contentGrid?.classList.add("content-grid-wide");
    }

    function applySalesLayout() {
        if (!isSalesPage) {
            return;
        }

        document.querySelector(".content-grid")?.classList.add("sales-layout");
        document.querySelector(".data-table")?.classList.add("sales-list-table");
    }

    function buildFormField(field) {
        const required = field.required ? "required" : "";
        const value = field.value || "";

        if (field.type === "items-builder") {
            return buildItemsBuilderField(field);
        }

        if (field.type === "textarea" || field.type === "json") {
            return `
                <div class="form-group">
                    <label for="${escapeHtml(field.name)}">
                        ${escapeHtml(field.label)}
                    </label>

                    <textarea
                        id="${escapeHtml(field.name)}"
                        name="${escapeHtml(field.name)}"
                        class="form-control"
                        ${required}>${escapeHtml(value)}</textarea>
                </div>
            `;
        }

        if (field.type === "select" || field.type === "remote-select") {
            const options = (field.options || [])
                .map(option => {
                    const selected =
                        String(option.value) === String(value)
                            ? "selected"
                            : "";

                    return `
                        <option
                            value="${escapeHtml(option.value)}"
                            ${selected}>
                            ${escapeHtml(option.label)}
                        </option>
                    `;
                })
                .join("");

            const placeholder = field.placeholder || "Selecione";
            const remoteOption =
                field.type === "remote-select" && !options
                    ? `<option value="">Carregando...</option>`
                    : `<option value="">${escapeHtml(placeholder)}</option>`;

            return `
                <div class="form-group">
                    <label for="${escapeHtml(field.name)}">
                        ${escapeHtml(field.label)}
                    </label>

                    <select
                        id="${escapeHtml(field.name)}"
                        name="${escapeHtml(field.name)}"
                        class="form-control"
                        ${required}>
                        ${remoteOption}
                        ${options}
                    </select>
                </div>
            `;
        }

        return `
            <div class="form-group">
                <label for="${escapeHtml(field.name)}">
                    ${escapeHtml(field.label)}
                </label>

                <input
                    id="${escapeHtml(field.name)}"
                    name="${escapeHtml(field.name)}"
                    type="${escapeHtml(field.type || "text")}"
                    class="form-control"
                    value="${escapeHtml(value)}"
                    ${buildFieldAttributes(field)}
                    ${required}>
            </div>
        `;
    }

    async function populateRemoteSelects() {
        const fields = (config.fields || [])
            .filter(field => field.type === "remote-select" && field.endpoint);

        await Promise.all(fields.map(async field => {
            const select = document.getElementById(field.name);

            if (!select) {
                return;
            }

            try {
                const response = await apiGet(field.endpoint);
                const rows = normalizeResponse(response);
                const labelKey = field.labelKey || "nome";
                const valueKey = field.valueKey || "id";
                const placeholder = field.placeholder || "Selecione";

                select.innerHTML =
                    `<option value="">${escapeHtml(placeholder)}</option>` +
                    rows.map(row => {
                        const value = row[valueKey] || "";
                        const label =
                            row[labelKey] ||
                            row.nome ||
                            row.email ||
                            value;

                        return `
                            <option value="${escapeHtml(value)}">
                                ${escapeHtml(label)}
                            </option>
                        `;
                    }).join("");
            } catch {
                select.innerHTML =
                    `<option value="">Não foi possível carregar</option>`;
            }
        }));

        await populateItemsBuilders();
    }

    async function populateItemsBuilders() {
        const fields = (config.fields || [])
            .filter(field => field.type === "items-builder" && field.endpoint);

        await Promise.all(fields.map(async field => {
            try {
                const response = await apiGet(field.endpoint);
                const rows = normalizeResponse(response);
                const builder =
                    document.querySelector(`[data-items-builder="${field.name}"]`);

                if (!builder) {
                    return;
                }

                builder.dataset.options = JSON.stringify(rows.map(row => ({
                    value: row[field.valueKey || "id"],
                    label: row[field.labelKey || "nome"],
                    price: row[field.priceKey || "preco"] || 0
                })));

                const list = builder.querySelector("[data-items-list]");

                if (list && !list.children.length) {
                    addItemRow(field.name);
                }
            } catch {
                const builder =
                    document.querySelector(`[data-items-builder="${field.name}"]`);

                if (builder) {
                    builder.querySelector("[data-items-list]").innerHTML = `
                        <div class="items-builder-empty">
                            Não foi possível carregar os produtos.
                        </div>
                    `;
                }
            }
        }));
    }

    function bindEvents() {
        const search = document.getElementById("pageSearch");
        const refresh = document.getElementById("refreshPage");
        const form = document.getElementById("recordForm");

        if (search) {
            search.addEventListener("input", renderTable);
        }

        if (refresh) {
            refresh.addEventListener("click", loadData);
        }

        if (form && !isSalesPage) {
            form.addEventListener("submit", saveRecord);
        }

        document.addEventListener("click", event => {
            const detailsButton =
                event.target.closest("[data-action='details']");
            const editButton =
                event.target.closest("[data-action='edit']");
            const deleteButton =
                event.target.closest("[data-action='delete']");
            const cancelButton =
                event.target.closest("#cancelEdit");
            const addItemButton =
                event.target.closest("[data-action='add-item']");
            const removeItemButton =
                event.target.closest("[data-action='remove-item']");
            const clearDetailsButton =
                event.target.closest("[data-action='clear-details']");
            const updateStatusButton =
                event.target.closest("[data-action='update-sale-status']");

            if (detailsButton && isSalesPage) {
                showSaleDetails(detailsButton.dataset.id);
                return;
            }

            if (updateStatusButton && isSalesPage) {
                updateSaleStatus(
                    updateStatusButton.closest("[data-sale-status-form]")
                );
                return;
            }

            if (clearDetailsButton && isSalesPage) {
                selectedSaleId = null;
                renderSaleEmptyState(form);
                return;
            }

            if (editButton && !isSalesPage) {
                editRecord(editButton.dataset.id);
            }

            if (deleteButton && !isSalesPage) {
                deleteRecord(deleteButton.dataset.id);
            }

            if (cancelButton && !isSalesPage) {
                resetForm();
            }

            if (addItemButton && !isSalesPage) {
                addItemRow(addItemButton.dataset.field);
            }

            if (removeItemButton && !isSalesPage) {
                const row =
                    removeItemButton.closest(".items-builder-row");
                const builder =
                    removeItemButton.closest("[data-items-builder]");

                row?.remove();
                refreshItemsBuilderTotal(builder);
            }
        });

        document.addEventListener("change", event => {
            if (isSalesPage) {
                return;
            }

            const productSelect =
                event.target.closest("[data-item-product]");

            if (!productSelect) {
                return;
            }

            const selected = productSelect.selectedOptions[0];
            const row = productSelect.closest(".items-builder-row");
            const price = row?.querySelector("[data-item-price]");

            if (price && selected?.dataset.price) {
                price.value = Number(selected.dataset.price).toFixed(2);
            }

            refreshItemsBuilderTotal(
                productSelect.closest("[data-items-builder]")
            );
        });

        document.addEventListener("input", event => {
            if (isSalesPage) {
                return;
            }

            if (
                event.target.closest("[data-item-quantity]") ||
                event.target.closest("[data-item-price]")
            ) {
                refreshItemsBuilderTotal(
                    event.target.closest("[data-items-builder]")
                );
            }
        });
    }

    async function loadData() {
        setStatus("Carregando dados...");

        try {
            if (config.mode === "single") {
                const response = await apiGet(config.endpoint);
                records = normalizeResponse(response).filter(Boolean);
                fillForm(records[0] || {});
            } else {
                const response = await apiGet(config.endpoint);
                records = normalizeResponse(response);
            }

            renderTable();
            renderScheduleCalendar();
            updateGenericInsights();
            updateScheduleInsights();
            updateSalesSummary();
            setStatus(`${records.length} registro(s) carregado(s).`);
        } catch (error) {
            records = [];
            renderTable();
            renderScheduleCalendar();
            updateGenericInsights();
            updateScheduleInsights();
            updateSalesSummary();
            setStatus(error.message || "Não foi possível carregar os dados.");
        }
    }

    async function saveRecord(event) {
        event.preventDefault();

        const payload = readForm();
        setStatus("Salvando...");

        try {
            if (config.mode === "single") {
                await apiPut(config.endpoint, payload);
            } else if (editingId) {
                await apiPut(`${config.endpoint}/${editingId}`, payload);
            } else {
                await apiPost(config.endpoint, payload);
            }

            resetForm();
            await loadData();
            setStatus("Registro salvo com sucesso.");
        } catch (error) {
            setStatus(error.message || "Não foi possível salvar.");
        }
    }

    async function deleteRecord(id) {
        if (!id || !confirm("Deseja remover este registro?")) {
            return;
        }

        setStatus("Removendo...");

        try {
            await apiDelete(`${config.endpoint}/${id}`);
            await loadData();
            setStatus("Registro removido com sucesso.");
        } catch (error) {
            setStatus(error.message || "Não foi possível remover.");
        }
    }

    function editRecord(id) {
        const record = records.find(item => String(item.id) === String(id));

        if (!record) {
            return;
        }

        editingId = id;
        fillForm(record);
        setText("formTitle", "Editar registro");
    }

    function fillForm(record) {
        (config.fields || []).forEach(field => {
            const input = document.querySelector(`[name="${field.name}"]`);

            if (field.type === "items-builder") {
                fillItemsBuilder(
                    field.name,
                    getRecordValue(record, field.name, [])
                );
                return;
            }

            if (!input) {
                return;
            }

            const value = getRecordValue(record, field.name, "");
            input.value =
                field.type === "json" && typeof value !== "string"
                    ? JSON.stringify(value || {}, null, 2)
                    : value;
        });
    }

    function resetForm() {
        editingId = null;
        buildForm();
        populateRemoteSelects();
        setText("formTitle", config.formTitle || "Novo registro");
    }

    function readForm() {
        const data = {};
        const form = document.getElementById("recordForm");

        if (!form) {
            return data;
        }

        (config.fields || []).forEach(field => {
            if (field.type === "items-builder") {
                data[field.name] = readItemsBuilder(field.name);
                return;
            }

            const input = form.elements[field.name];

            if (!input) {
                return;
            }

            let value = input.value.trim();

            if (field.type === "number") {
                value = value === "" ? null : Number(value);
            }

            if (field.type === "checkbox") {
                value = input.checked;
            }

            if (field.type === "json") {
                try {
                    value = value ? JSON.parse(value) : null;
                } catch {
                    value = null;
                }
            }

            data[field.name] = value;
        });

        return data;
    }

    function renderTable() {
        const head = document.getElementById("tableHead");
        const body = document.getElementById("tableBody");

        if (!head || !body) {
            return;
        }

        const search = normalizeSearch(
            document.getElementById("pageSearch")?.value || ""
        );

        const columns = config.columns || [];
        const showActions = config.mode !== "single" && !isReadOnlyPage;
        const filtered = records.filter(record =>
            normalizeSearch(JSON.stringify(record)).includes(search)
        );

        if (isSalesPage) {
            renderSalesList(head, body, filtered);
            return;
        }

        head.innerHTML = `
            <tr>
                ${columns.map(column => `
                    <th>${escapeHtml(column.label)}</th>
                `).join("")}

                ${showActions ? "<th>Ações</th>" : ""}
            </tr>
        `;

        if (!filtered.length) {
            body.innerHTML = `
                <tr>
                    <td colspan="${columns.length + (showActions ? 1 : 0)}">
                        <div class="empty-state">
                            <i class="fa-regular fa-folder-open"></i>

                            <strong>Nenhum registro encontrado</strong>

                            <span>
                                Não existem registros para exibir.
                            </span>
                        </div>
                    </td>
                </tr>
            `;

            return;
        }

        body.innerHTML = filtered.map(record => `
            <tr>
                ${columns.map(column => `
                    <td>
                        ${formatValue(
                            getRecordValue(record, column.key),
                            column
                        )}
                    </td>
                `).join("")}

                ${showActions ? `
                    <td>
                        <div class="row-actions">
                            ${buildRowActions(record)}
                        </div>
                    </td>
                ` : ""}
            </tr>
        `).join("");
    }

    function renderSalesList(head, body, filtered) {
        head.innerHTML = "";

        if (!filtered.length) {
            body.innerHTML = `
                <tr>
                    <td>
                        <div class="empty-state">
                            <i class="fa-regular fa-folder-open"></i>

                            <strong>Nenhum pedido encontrado</strong>

                            <span>
                                Não existem pedidos para exibir.
                            </span>
                        </div>
                    </td>
                </tr>
            `;

            return;
        }

        body.innerHTML = filtered.map(record => `
            <tr class="sale-card-row">
                <td>
                    <article class="sale-card-summary">
                        <header>
                            <div>
                                <span>Pedido #${escapeHtml(shortRecordId(record.id))}</span>
                                <strong>${escapeHtml(record.cliente_nome || "Cliente não informado")}</strong>
                            </div>

                            ${formatValue(record.status, { type: "status" })}
                        </header>

                        <dl>
                            <div>
                                <dt>Data</dt>
                                <dd>${escapeHtml(formatAdminDate(record.data_venda))}</dd>
                            </div>

                            <div>
                                <dt>Itens</dt>
                                <dd>${escapeHtml(record.quantidade_itens || 0)}</dd>
                            </div>

                            <div>
                                <dt>Pagamento</dt>
                                <dd>${escapeHtml(formatPaymentLabel(record.forma_pagamento))}</dd>
                            </div>

                            <div>
                                <dt>Total</dt>
                                <dd>${formatAdminCurrency(record.valor_final)}</dd>
                            </div>
                        </dl>

                        <footer>
                            <button
                                class="btn btn-small"
                                type="button"
                                data-action="details"
                                data-id="${escapeHtml(record.id)}">
                                <i class="fa-solid fa-receipt"></i>
                                Ver detalhes
                            </button>
                        </footer>
                    </article>
                </td>
            </tr>
        `).join("");
    }

    function buildRowActions(record) {
        if (isSalesPage) {
            return `
                <button
                    class="btn btn-small"
                    type="button"
                    data-action="details"
                    data-id="${escapeHtml(record.id)}"
                    title="Ver detalhes e atualizar status">
                    <i class="fa-solid fa-eye"></i>
                    Status
                </button>
            `;
        }

        return `
            <button
                class="icon-btn"
                type="button"
                data-action="edit"
                data-id="${escapeHtml(record.id)}"
                title="Editar">
                <i class="fa-solid fa-pen"></i>
            </button>

            <button
                class="icon-btn"
                type="button"
                data-action="delete"
                data-id="${escapeHtml(record.id)}"
                title="Excluir">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
    }

    function renderSaleEmptyState(container) {
        selectedSaleId = null;
        setText("formTitle", "Detalhes do pedido");

        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-receipt"></i>

                <strong>Selecione um pedido</strong>

                <span>
                    Os detalhes completos do pedido aparecerão neste painel.
                </span>
            </div>
        `;
    }

    async function showSaleDetails(id) {
        const form = document.getElementById("recordForm");

        if (!form || !id) {
            return;
        }

        selectedSaleId = id;
        setText("formTitle", "Detalhes do pedido");

        form.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-spinner fa-spin"></i>

                <strong>Carregando pedido...</strong>

                <span>
                    Aguarde enquanto buscamos os detalhes.
                </span>
            </div>
        `;

        try {
            const sale = await apiGet(`${config.endpoint}/${id}`);
            renderSaleDetails(form, sale);
            form.closest(".panel")?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        } catch (error) {
            form.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-triangle-exclamation"></i>

                    <strong>
                        Não foi possível carregar o pedido
                    </strong>

                    <span>
                        ${escapeHtml(error.message || "Tente novamente.")}
                    </span>
                </div>
            `;
        }
    }

    function renderSaleDetails(container, sale) {
        const customer = sale?.cliente || {};
        const items = Array.isArray(sale?.itens) ? sale.itens : [];
        const address = formatCustomerAddress(customer);
        const currentStatus = sale?.status || "";

        container.innerHTML = `
            <section class="sale-details">
                <div class="form-group">
                    <label>Pedido</label>

                    <strong>
                        #${escapeHtml(shortRecordId(sale?.id))}
                    </strong>
                </div>

                <div
                    class="form-group"
                    data-sale-status-form
                    data-id="${escapeHtml(sale?.id || selectedSaleId || "")}">
                    <label for="saleStatus">Status do pedido</label>

                    <select
                        id="saleStatus"
                        name="status"
                        class="form-control"
                        required>
                        ${buildSaleStatusOptions(currentStatus)}
                    </select>

                    <button
                        class="btn btn-primary"
                        type="button"
                        data-action="update-sale-status">
                        Atualizar status
                    </button>
                </div>

                <div class="form-group">
                    <label>Data</label>

                    <span>
                        ${escapeHtml(formatAdminDate(sale?.data_venda))}
                    </span>
                </div>

                <div class="form-group">
                    <label>Cliente</label>

                    <strong>
                        ${escapeHtml(customer.nome || "Cliente não informado")}
                    </strong>

                    <span>
                        ${escapeHtml(customer.email || "E-mail não informado")}
                    </span>

                    <span>
                        ${escapeHtml(
                            customer.whatsapp ||
                            customer.telefone ||
                            "Telefone não informado"
                        )}
                    </span>
                </div>

                <div class="form-group">
                    <label>Endereço de entrega</label>

                    <span>
                        ${escapeHtml(address)}
                    </span>

                    ${customer.cep ? `
                        <span>
                            CEP: ${escapeHtml(customer.cep)}
                        </span>
                    ` : ""}
                </div>

                <div class="form-group">
                    <label>Forma de pagamento</label>

                    <span>
                        ${escapeHtml(formatPaymentLabel(sale?.forma_pagamento))}
                    </span>
                </div>

                <div class="form-group">
                    <label>Itens do pedido</label>

                    <div class="sale-items">
                        ${items.length ? items.map(item => `
                            <article class="sale-item">
                                <div>
                                    <strong>
                                        ${escapeHtml(item.produto || "Produto")}
                                    </strong>

                                    <span>
                                        ${Number(item.quantidade || 0)}
                                        x
                                        ${formatAdminCurrency(item.preco_unitario)}
                                    </span>
                                </div>

                                <b>
                                    ${formatAdminCurrency(item.subtotal)}
                                </b>
                            </article>
                        `).join("") : `
                            <span>
                                Nenhum item encontrado.
                            </span>
                        `}
                    </div>
                </div>

                <div class="form-group">
                    <label>Valores</label>

                    <span>
                        Total dos produtos:
                        ${formatAdminCurrency(sale?.valor_total)}
                    </span>

                    <span>
                        Desconto:
                        ${formatAdminCurrency(sale?.desconto)}
                    </span>

                    <span>
                        Acréscimo:
                        ${formatAdminCurrency(sale?.acrescimo)}
                    </span>

                    <strong>
                        Total final:
                        ${formatAdminCurrency(sale?.valor_final)}
                    </strong>
                </div>

                <div class="form-group">
                    <label>Observações</label>

                    <span>
                        ${escapeHtml(
                            sale?.observacoes ||
                            "Nenhuma observação."
                        )}
                    </span>
                </div>

                <div class="form-actions">
                    <button
                        class="btn"
                        type="button"
                        data-action="clear-details">
                        Fechar detalhes
                    </button>
                </div>
            </section>
        `;
    }

    function buildSaleStatusOptions(currentStatus) {
        return getSaleStatusOptions()
            .map(option => {
                const selected =
                    String(option.value) === String(currentStatus)
                        ? "selected"
                        : "";

                return `
                    <option
                        value="${escapeHtml(option.value)}"
                        ${selected}>
                        ${escapeHtml(option.label)}
                    </option>
                `;
            })
            .join("");
    }

    function getSaleStatusOptions() {
        const statusField = (config.fields || [])
            .find(field => field.name === "status");

        if (Array.isArray(statusField?.options) && statusField.options.length) {
            return statusField.options;
        }

        return [
            {
                value: "AGUARDANDO_PAGAMENTO",
                label: "Aguardando pagamento"
            },
            {
                value: "PAGAMENTO_APROVADO",
                label: "Pedido recebido"
            },
            {
                value: "EM_SEPARACAO",
                label: "Preparando"
            },
            {
                value: "SAIU_PARA_ENTREGA",
                label: "Saiu para entrega"
            },
            {
                value: "ENTREGUE",
                label: "Entregue"
            },
            {
                value: "FINALIZADA",
                label: "Finalizado"
            },
            {
                value: "CANCELADA",
                label: "Cancelado"
            }
        ];
    }

    async function updateSaleStatus(statusForm) {
        if (!statusForm) {
            return;
        }

        const id = statusForm.dataset.id || selectedSaleId;
        const status =
            statusForm.querySelector("[name='status']")?.value;

        if (!id || !status) {
            setStatus("Selecione um status válido.");
            return;
        }

        const button =
            statusForm.querySelector("[data-action='update-sale-status']");
        const originalText = button?.textContent;

        if (button) {
            button.disabled = true;
            button.textContent = "Atualizando...";
        }

        setStatus("Atualizando status do pedido...");

        try {
            await patchRequest(`${config.endpoint}/${id}/status`, {
                status
            });

            await loadData();
            await showSaleDetails(id);
            setStatus("Status do pedido atualizado com sucesso.");
        } catch (error) {
            setStatus(error.message || "Não foi possível atualizar o status.");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = originalText || "Atualizar status";
            }
        }
    }

    async function patchRequest(endpoint, data) {
        if (typeof apiPatch === "function") {
            return apiPatch(endpoint, data);
        }

        if (typeof request === "function") {
            return request(endpoint, {
                method: "PATCH",
                body: JSON.stringify(data)
            });
        }

        throw new Error("Recurso de atualização não disponível.");
    }

    function formatCustomerAddress(customer) {
        const street = [
            customer.endereco,
            customer.numero
        ]
            .filter(Boolean)
            .join(", ");

        const city = [
            customer.bairro,
            customer.cidade,
            customer.estado
        ]
            .filter(Boolean)
            .join(", ");

        return [
            street,
            customer.complemento,
            city
        ]
            .filter(Boolean)
            .join(" - ") ||
            "Endereço não informado";
    }

    function formatAdminCurrency(value) {
        return Number(value || 0).toLocaleString(
            "pt-BR",
            {
                style: "currency",
                currency: "BRL"
            }
        );
    }

    function formatAdminDate(value) {
        if (!value) {
            return "Data não informada";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "Data inválida";
        }

        return date.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function formatPaymentLabel(value) {
        const labels = {
            DINHEIRO: "Dinheiro",
            PIX: "PIX",
            CARTAO_DEBITO: "Cartão de débito",
            CARTAO_CREDITO: "Cartão de crédito",
            PAGBANK: "Aguardando pagamento"
        };

        return labels[value] ||
            String(value || "Não informado")
                .replaceAll("_", " ");
    }

    function shortRecordId(id) {
        return String(id || "")
            .slice(0, 8)
            .toUpperCase();
    }

    function normalizeResponse(response) {
        if (Array.isArray(response)) {
            return response;
        }

        if (Array.isArray(response?.data)) {
            return response.data;
        }

        if (response?.data) {
            return [response.data];
        }

        return [];
    }

    function getRecordValue(record, key, fallback = undefined) {
        if (!record || !key) {
            return fallback;
        }

        if (Object.prototype.hasOwnProperty.call(record, key)) {
            return record[key];
        }

        const snakeKey = toSnake(key);

        if (Object.prototype.hasOwnProperty.call(record, snakeKey)) {
            return record[snakeKey];
        }

        return fallback;
    }

    function formatValue(value, column = {}) {
        if (value === null || value === undefined || value === "") {
            return "-";
        }

        if (typeof value === "boolean") {
            return value ? "Sim" : "Não";
        }

        if (Array.isArray(value)) {
            return `${value.length} item(ns)`;
        }

        if (
            column.type === "currency" ||
            ["preco", "custo", "valor_total", "valor_final", "total"]
                .includes(column.key)
        ) {
            const number = Number(value);

            if (!Number.isNaN(number)) {
                return formatAdminCurrency(number);
            }
        }

        if (column.type === "status" || column.key === "status") {
            return `
                <span class="status-badge">
                    ${escapeHtml(formatStatusLabel(value))}
                </span>
            `;
        }

        if (column.type === "date") {
            return escapeHtml(formatAdminDate(value));
        }

        if (column.type === "payment") {
            return escapeHtml(formatPaymentLabel(value));
        }

        return escapeHtml(String(value));
    }

    function renderScheduleCalendar() {
        if (!isSchedulePage || !config.calendar) {
            return;
        }

        const grid = document.getElementById("scheduleCalendarGrid");
        const title = document.getElementById("scheduleCalendarTitle");

        if (!grid || !title) {
            return;
        }

        const year = scheduleDate.getFullYear();
        const month = scheduleDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const start = new Date(year, month, 1 - firstDay.getDay());
        const todayKey = formatDateKey(new Date());

        title.textContent = new Intl.DateTimeFormat("pt-BR", {
            month: "long",
            year: "numeric"
        }).format(firstDay);

        const days = Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            return date;
        });

        grid.innerHTML = days.map(date => {
            const key = formatDateKey(date);
            const dayRecords = records
                .filter(record => formatDateKey(getRecordValue(record, "data")) === key)
                .sort((a, b) => String(a.hora || "").localeCompare(String(b.hora || "")));

            return `
                <article class="schedule-day ${date.getMonth() === month ? "" : "is-muted"} ${key === todayKey ? "is-today" : ""}">
                    <header>
                        <span>${date.getDate()}</span>
                        <small>${dayRecords.length ? `${dayRecords.length} agenda(s)` : ""}</small>
                    </header>

                    <div class="schedule-day-items">
                        ${dayRecords.slice(0, 4).map(record => `
                            <button
                                class="schedule-event"
                                type="button"
                                data-action="edit"
                                data-id="${escapeHtml(record.id)}"
                                data-status="${escapeHtml(record.status || "AGENDADO")}">
                                <strong>${escapeHtml(formatTime(record.hora))} - ${escapeHtml(record.pet || "Pet")}</strong>
                                <span>${escapeHtml(record.servico || "Serviço")} • ${escapeHtml(record.cliente || "Cliente")}</span>
                                <em>${escapeHtml(formatStatusLabel(record.status))}</em>
                            </button>
                        `).join("")}
                        ${dayRecords.length > 4 ? `<small class="schedule-more">+${dayRecords.length - 4} outro(s)</small>` : ""}
                    </div>
                </article>
            `;
        }).join("");
    }

    function updateScheduleInsights() {
        if (!isSchedulePage) {
            return;
        }

        document.querySelectorAll("[data-insight-key], [data-insight-index]").forEach(card => {
            const status = config.insights?.[Number(card.dataset.insightIndex)]?.status;

            if (!status) {
                return;
            }

            const value = card.querySelector("[data-insight-value]");

            if (value) {
                value.textContent = String(
                    records.filter(record => record.status === status).length
                );
            }
        });
    }

    function updateSalesSummary() {
        if (!isSalesPage) {
            return;
        }

        const todayKey = formatDateKey(new Date());
        const deliveredRevenue = records
            .filter(record => isDeliveredStatus(record.status))
            .reduce((sum, record) => sum + Number(record.valor_final || 0), 0);
        const todayOrders = records.filter(record =>
            formatDateKey(record.data_venda) === todayKey
        );
        const pendingOrders = records.filter(record =>
            isPendingStatus(record.status)
        );
        const deliveryOrders = records.filter(record =>
            record.status === "SAIU_PARA_ENTREGA"
        );

        const summary = {
            today: {
                value: String(todayOrders.length),
                note: `${pendingOrders.length} pedido(s) pendente(s)`
            },
            delivery: {
                value: String(deliveryOrders.length),
                note: "Pedido(s) em rota"
            },
            paid: {
                value: formatAdminCurrency(deliveredRevenue),
                note: "Total concluído"
            },
            pending: {
                value: String(pendingOrders.length),
                note: "Precisam de atenção"
            }
        };

        document.querySelectorAll("[data-insight-key]").forEach(card => {
            const data = summary[card.dataset.insightKey];

            if (!data) {
                return;
            }

            const value = card.querySelector("[data-insight-value]");
            const note = card.querySelector("[data-insight-note]");

            if (value) {
                value.textContent = data.value;
            }

            if (note) {
                note.textContent = data.note;
            }
        });

        document.querySelectorAll("[data-pipeline-status]").forEach(step => {
            const status = step.dataset.pipelineStatus;
            const value = step.querySelector("[data-pipeline-value]");

            if (!value) {
                return;
            }

            value.textContent = String(
                records.filter(record => record.status === status).length
            );
        });
    }

    function updateGenericInsights() {
        if (isSalesPage || isSchedulePage) {
            return;
        }

        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        const totalPets = records.reduce(
            (sum, record) => sum + Number(record.total_pets || 0),
            0
        );

        const summary = {
            total: String(records.length),
            active: String(records.filter(record => record.ativo !== false).length),
            inactive: String(records.filter(record => record.ativo === false).length),
            with_pets: String(records.filter(record => Number(record.total_pets || 0) > 0).length),
            pets: String(totalPets),
            new_month: String(records.filter(record => {
                const date = new Date(record.created_at);

                return !Number.isNaN(date.getTime()) &&
                    date.getMonth() === currentMonth &&
                    date.getFullYear() === currentYear;
            }).length)
        };

        document.querySelectorAll("[data-insight-key]").forEach(card => {
            const key = card.dataset.insightKey;
            const value = card.querySelector("[data-insight-value]");

            if (value && Object.prototype.hasOwnProperty.call(summary, key)) {
                value.textContent = summary[key];
            }
        });
    }

    function isPendingStatus(status) {
        return [
            "PENDENTE",
            "AGUARDANDO_PAGAMENTO",
            "PAGAMENTO_APROVADO",
            "EM_SEPARACAO"
        ].includes(status);
    }

    function isDeliveredStatus(status) {
        return [
            "ENTREGUE",
            "FINALIZADA"
        ].includes(status);
    }

    function formatDateKey(value) {
        if (!value) {
            return "";
        }

        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
            return value.slice(0, 10);
        }

        const date = value instanceof Date ? value : new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function formatTime(value) {
        return String(value || "").slice(0, 5) || "--:--";
    }

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value || "";
        }
    }

    function setStatus(message) {
        setText("statusLine", message);
    }

    function formatStatusLabel(value) {
        const labels = {
            PENDENTE: "Pendente",
            AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
            PAGAMENTO_APROVADO: "Pedido recebido",
            EM_SEPARACAO: "Preparando",
            SAIU_PARA_ENTREGA: "Saiu para entrega",
            ENTREGUE: "Entregue",
            FINALIZADA: "Finalizado",
            CANCELADA: "Cancelado",
            AGENDADO: "Solicitado",
            CONFIRMADO: "Confirmado",
            EM_ANDAMENTO: "Em atendimento",
            CONCLUIDO: "Concluído",
            CANCELADO: "Cancelado",
            FALTOU: "Não compareceu",
            PAGO: "Pago",
            ATRASADO: "Atrasado"
        };

        return labels[value] ||
            String(value || "")
                .replaceAll("_", " ")
                .toLowerCase();
    }

    function toSnake(value) {
        return value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    }

    function buildFieldAttributes(field) {
        const attributes = [];

        [
            "placeholder",
            "min",
            "max",
            "step",
            "pattern",
            "title",
            "minlength",
            "maxlength"
        ].forEach(attribute => {
            if (field[attribute] !== undefined && field[attribute] !== null) {
                attributes.push(
                    `${attribute}="${escapeHtml(field[attribute])}"`
                );
            }
        });

        return attributes.join(" ");
    }

    function buildItemsBuilderField(field) {
        return `
            <div
                class="form-group items-builder"
                data-items-builder="${escapeHtml(field.name)}"
                data-product-key="${escapeHtml(field.productKey || "produto_id")}"
                data-price-key="${escapeHtml(field.priceField || "valor_unitario")}">
                <div class="items-builder-header">
                    <label>${escapeHtml(field.label || "Itens")}</label>

                    <button
                        class="btn btn-small"
                        type="button"
                        data-action="add-item"
                        data-field="${escapeHtml(field.name)}">
                        <i class="fa-solid fa-plus"></i>
                        Adicionar item
                    </button>
                </div>

                <div class="items-builder-columns">
                    <span>Produto</span>
                    <span>Qtd</span>
                    <span>Valor unit.</span>
                    <span></span>
                </div>

                <div class="items-builder-list" data-items-list></div>

                <div class="items-builder-total">
                    <span>Total estimado</span>
                    <strong data-items-total>R$ 0,00</strong>
                </div>
            </div>
        `;
    }

    function addItemRow(fieldName, item = {}) {
        const builder =
            document.querySelector(`[data-items-builder="${fieldName}"]`);
        const list = builder?.querySelector("[data-items-list]");

        if (!builder || !list) {
            return;
        }

        const options = JSON.parse(builder.dataset.options || "[]");
        const productValue =
            item.produto_id ||
            item.produtoId ||
            item.id ||
            "";
        const quantity = item.quantidade || 1;
        const price =
            item.valor_unitario ||
            item.valorUnitario ||
            item.preco_unitario ||
            item.preco ||
            0;

        const row = document.createElement("div");
        row.className = "items-builder-row";
        row.innerHTML = `
            <select class="form-control" data-item-product required>
                <option value="">Selecione</option>
                ${options.map(option => `
                    <option
                        value="${escapeHtml(option.value)}"
                        data-price="${escapeHtml(option.price)}"
                        ${String(option.value) === String(productValue) ? "selected" : ""}>
                        ${escapeHtml(option.label || option.value)}
                    </option>
                `).join("")}
            </select>

            <input
                class="form-control"
                type="number"
                min="1"
                step="1"
                value="${escapeHtml(quantity)}"
                data-item-quantity
                required>

            <input
                class="form-control"
                type="number"
                min="0"
                step="0.01"
                value="${escapeHtml(price)}"
                data-item-price
                required>

            <button
                class="icon-btn"
                type="button"
                data-action="remove-item"
                title="Remover item">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;

        list.appendChild(row);
        refreshItemsBuilderTotal(builder);
    }

    function fillItemsBuilder(fieldName, items) {
        const builder =
            document.querySelector(`[data-items-builder="${fieldName}"]`);
        const list = builder?.querySelector("[data-items-list]");

        if (!builder || !list) {
            return;
        }

        list.innerHTML = "";

        (Array.isArray(items) && items.length ? items : [{}])
            .forEach(item => addItemRow(fieldName, item));

        refreshItemsBuilderTotal(builder);
    }

    function readItemsBuilder(fieldName) {
        const builder =
            document.querySelector(`[data-items-builder="${fieldName}"]`);
        const productKey = builder?.dataset.productKey || "produto_id";
        const priceKey = builder?.dataset.priceKey || "valor_unitario";

        return [...(builder?.querySelectorAll(".items-builder-row") || [])]
            .map(row => {
                const produto =
                    row.querySelector("[data-item-product]")?.value;
                const quantidade = Number(
                    row.querySelector("[data-item-quantity]")?.value || 0
                );
                const valor = Number(
                    row.querySelector("[data-item-price]")?.value || 0
                );

                return {
                    [productKey]: produto,
                    quantidade,
                    [priceKey]: valor
                };
            })
            .filter(item => item[productKey] && item.quantidade > 0);
    }

    function refreshItemsBuilderTotal(builder) {
        if (!builder) {
            return;
        }

        const total = [...builder.querySelectorAll(".items-builder-row")]
            .reduce((sum, row) => {
                const quantity = Number(
                    row.querySelector("[data-item-quantity]")?.value || 0
                );
                const price = Number(
                    row.querySelector("[data-item-price]")?.value || 0
                );

                return sum + quantity * price;
            }, 0);

        const totalElement = builder.querySelector("[data-items-total]");

        if (totalElement) {
            totalElement.textContent = formatAdminCurrency(total);
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function normalizeSearch(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
    }
})();
