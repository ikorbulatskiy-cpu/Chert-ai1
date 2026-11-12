(() => {
  const $ = selector => document.querySelector(selector);
  const logList = $("#log-list");
  const importList = $("#import-list");
  const processedList = $("#processed-list");
  const defaults = { messageMonitoring: false, autoReply: false, notifications: true };
  let settings = { ...defaults };
  let backendOnline = false;
  let apiToken = "";

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(apiToken ? { authorization: "Bearer " + apiToken } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
    return data;
  }
  function setPill(id, text, state) {
    const el = $(id);
    el.textContent = text;
    el.dataset.state = state;
  }
  function renderEntries(target, entries, emptyText, includeText) {
    target.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "log-empty";
      empty.textContent = emptyText;
      target.append(empty);
      return;
    }
    entries.forEach(entry => {
      const row = document.createElement("div");
      row.className = "log-entry import-entry";
      const meta = document.createElement("div");
      meta.className = "import-meta";
      meta.textContent = new Date(entry.at).toLocaleString("ru-RU") + " · " + (entry.pageTitle || entry.event || "Событие");
      row.append(meta);
      if (includeText && entry.text) {
        const body = document.createElement("pre");
        body.className = "import-text";
        body.textContent = entry.text;
        row.append(body);
      } else if (entry.event) {
        const message = document.createElement("div");
        message.className = "log-message";
        message.textContent = entry.event + (Object.keys(entry.details || {}).length ? " · " + JSON.stringify(entry.details) : "");
        row.append(message);
      }
      target.append(row);
    });
  }
  async function refreshLogs() {
    const data = await api("/api/logs?limit=100");
    renderEntries(logList, data.entries || [], "Событий пока нет.", false);
  }
  async function refreshImports() {
    const data = await api("/api/galaxy/imports?limit=20");
    renderEntries(importList, data.entries || [], "Импортированных выделений пока нет.", true);
  }
  async function refreshProcessed() {
    const data = await api("/api/galaxy/processed?limit=30");
    processedList.replaceChildren();
    if (!(data.entries || []).length) {
      const empty = document.createElement("p");
      empty.className = "log-empty";
      empty.textContent = "Обработанных диалогов пока нет.";
      processedList.append(empty);
      return;
    }
    data.entries.forEach(item => {
      const card = document.createElement("article");
      card.className = "processed-card";
      const title = document.createElement("b");
      title.textContent = item.pageTitle || "Диалог Galaxy";
      card.append(title);
      const meta = document.createElement("p");
      meta.textContent = new Date(item.at).toLocaleString("ru-RU") + " · распознано сообщений: " + item.messageCount;
      card.append(meta);
      (item.messages || []).forEach(message => {
        const row = document.createElement("div");
        row.className = "parsed-message";
        const who = document.createElement("strong");
        who.textContent = (message.sender || "Не определён") + (message.time ? " · " + message.time : "");
        const body = document.createElement("div");
        body.textContent = message.text;
        row.append(who, body);
        card.append(row);
      });
      if (item.replyDraft) {
        const draft = document.createElement("div");
        draft.className = "reply-draft";
        const label = document.createElement("strong");
        label.textContent = "Черновик ответа · не отправлен";
        const content = document.createElement("p");
        content.textContent = item.replyDraft.text;
        draft.append(label, content);
        card.append(draft);
      }
      processedList.append(card);
    });
  }
  async function refreshStatus() {
    const data = await api("/api/status");
    backendOnline = true;
    $("#backend-state").textContent = "BACKEND ONLINE";
    $("#backend-detail").textContent = "Сервер отвечает · " + new Date(data.time).toLocaleTimeString("ru-RU");
    $("#backend-value").textContent = "ONLINE";
    setPill("#backend-pill", "РАБОТАЕТ", "ok");
    $("#bot-value").textContent = data.bot.running ? "ЗАПУЩЕН" : "ОСТАНОВЛЕН";
    $("#uptime-value").textContent = data.bot.running ? data.bot.uptimeSeconds + " сек." : "—";
    const g = data.galaxy;
    if (g.state !== "not_checked") {
      $("#galaxy-detail").textContent = g.detail;
      setPill("#galaxy-pill", g.httpStatus ? "HTTP " + g.httpStatus : g.state.toUpperCase(), g.state === "reachable" ? "ok" : "warn");
    }
    settings = { ...defaults, ...data.settings };
    document.querySelectorAll("[data-setting]").forEach(input => input.checked = Boolean(settings[input.dataset.setting]));
    $("#settings-state").textContent = "Настройки сохраняются backend-сервером.";
  }
  async function refreshAll() {
    try {
      if (!apiToken) {
        const health = await fetch("/api/health", { cache: "no-store" });
        if (!health.ok) throw new Error("HTTP " + health.status);
        backendOnline = true;
        $("#backend-state").textContent = "BACKEND ONLINE";
        $("#backend-detail").textContent = "Сервер отвечает. Подключи API-токен для защищённых функций.";
        $("#backend-value").textContent = "ONLINE";
        setPill("#backend-pill", "СЕРВЕР ДОСТУПЕН", "ok");
        $("#settings-state").textContent = "Введи API-токен, чтобы загрузить настройки и журнал.";
        return;
      }
      await refreshStatus();
      await Promise.all([refreshLogs(), refreshImports(), refreshProcessed()]);
    } catch (error) {
      backendOnline = false;
      $("#backend-state").textContent = "BACKEND OFFLINE";
      $("#backend-detail").textContent = error.message + ". Сервер недоступен.";
      $("#backend-value").textContent = "OFFLINE";
      setPill("#backend-pill", "НЕТ СВЯЗИ", "warn");
      $("#settings-state").textContent = "Настройки backend недоступны.";
    }
  }

  $("#galaxy-text").addEventListener("input", () => {
    $("#galaxy-char-count").textContent = $("#galaxy-text").value.length + " / 8000";
  });
  $("#import-galaxy-text").addEventListener("click", async () => {
    const button = $("#import-galaxy-text");
    const text = $("#galaxy-text").value.trim();
    if (!apiToken) {
      $("#bridge-state").textContent = "Сначала подключи защищённый API выше.";
      return;
    }
    if (!text) {
      $("#bridge-state").textContent = "Сначала вставь скопированный текст из Galaxy.";
      return;
    }
    button.disabled = true;
    button.textContent = "Импорт…";
    try {
      const result = await api("/api/galaxy/import", {
        method: "POST",
        body: JSON.stringify({
          text,
          pageTitle: "Ручной импорт из Galaxy",
          pageUrl: "https://galaxy.mobstudio.ru/web/"
        })
      });
      $("#bridge-state").textContent = "Импортировано " + result.imported.characters + " символов. Данные сохранены на backend.";
      $("#galaxy-text").value = "";
      $("#galaxy-char-count").textContent = "0 / 8000";
      const processed = await api("/api/galaxy/process", { method: "POST", body: JSON.stringify({}) });
      $("#bridge-state").textContent += " Обработано сообщений: " + processed.processed.messageCount + ".";
      await Promise.all([refreshImports(), refreshLogs(), refreshProcessed()]);
    } catch (error) {
      $("#bridge-state").textContent = "Импорт не выполнен: " + error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Импортировать текст";
    }
  });

  document.querySelectorAll("[data-setting]").forEach(input => {
    input.addEventListener("change", async () => {
      settings[input.dataset.setting] = input.checked;
      try {
        await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
        $("#settings-state").textContent = "Настройки сохранены на backend.";
        await refreshLogs();
      } catch (error) {
        input.checked = !input.checked;
        settings[input.dataset.setting] = input.checked;
        $("#settings-state").textContent = "Не удалось сохранить: " + error.message;
      }
    });
  });
  $("#connect-api").addEventListener("click", async () => {
    const candidate = $("#api-token").value.trim();
    if (candidate.length < 32) { $("#api-auth-state").textContent = "Токен должен содержать не менее 32 символов."; return; }
    apiToken = candidate;
    $("#api-token").value = "";
    try {
      await refreshStatus();
      await Promise.all([refreshLogs(), refreshImports(), refreshProcessed()]);
      $("#api-auth-state").textContent = "Защищённый API подключён. Токен хранится только в памяти этой вкладки.";
    } catch (error) {
      apiToken = "";
      $("#api-auth-state").textContent = "Проверка не пройдена: " + error.message + ". Токен очищен.";
      await refreshAll();
    }
  });
  $("#disconnect-api").addEventListener("click", async () => {
    apiToken = "";
    $("#api-auth-state").textContent = "Токен очищен из памяти вкладки.";
    await refreshAll();
  });
  $("#start-bot").addEventListener("click", async () => {
    try { await api("/api/bot/start", { method: "POST" }); await refreshAll(); }
    catch (error) { $("#backend-detail").textContent = error.message; }
  });
  $("#stop-bot").addEventListener("click", async () => {
    try { await api("/api/bot/stop", { method: "POST" }); await refreshAll(); }
    catch (error) { $("#backend-detail").textContent = error.message; }
  });
  $("#check-galaxy").addEventListener("click", async () => {
    const button = $("#check-galaxy");
    button.disabled = true;
    button.textContent = "Проверка…";
    try { await api("/api/galaxy/check", { method: "POST" }); await refreshAll(); }
    catch (error) { $("#galaxy-detail").textContent = error.message; }
    finally { button.disabled = false; button.textContent = "Проверить доступность сайта"; }
  });
  $("#refresh-log").addEventListener("click", () => refreshLogs().catch(error => renderEntries(logList, [{ at: new Date().toISOString(), event: "Ошибка загрузки журнала", details: { message: error.message } }], "", false)));
  $("#refresh-imports").addEventListener("click", () => refreshImports().catch(error => renderEntries(importList, [{ at: new Date().toISOString(), pageTitle: "Ошибка загрузки: " + error.message }], "", false)));
  $("#process-imports").addEventListener("click", async () => {
    const button = $("#process-imports");
    button.disabled = true;
    button.textContent = "Обработка…";
    try {
      const result = await api("/api/galaxy/process", { method: "POST", body: JSON.stringify({}) });
      $("#processing-state").textContent = "Распознано сообщений: " + result.processed.messageCount + ". Черновик ответа подготовлен, но не отправлен.";
      await refreshProcessed();
    } catch (error) {
      $("#processing-state").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Обработать новый импорт";
    }
  });
  refreshAll();
  setInterval(() => {
    if (!backendOnline) return;
    if (apiToken) refreshStatus().catch(() => { backendOnline = false; });
    else refreshAll();
  }, 15000);
})();