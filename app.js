(() => {
  const $ = (selector) => document.querySelector(selector);
  const logList = $("#log-list");
  const defaults = { messageMonitoring: false, autoReply: false, notifications: true };
  let settings = { ...defaults };
  let backendOnline = false;\n  let apiToken = "";

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
  function renderLogs(entries) {
    logList.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "log-empty";
      empty.textContent = "Событий пока нет.";
      logList.append(empty);
      return;
    }
    entries.forEach(entry => {
      const row = document.createElement("div");
      row.className = "log-entry";
      const time = document.createElement("span");
      time.className = "log-time";
      time.textContent = new Date(entry.at).toLocaleString("ru-RU");
      const message = document.createElement("span");
      message.className = "log-message";
      message.textContent = entry.event + (Object.keys(entry.details || {}).length ? " · " + JSON.stringify(entry.details) : "");
      row.append(time, message);
      logList.append(row);
    });
  }
  async function refreshLogs() {
    const data = await api("/api/logs?limit=100");
    renderLogs(data.entries || []);
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
    $("#settings-state").textContent = "Настройки загружаются и сохраняются backend-сервером.";
  }
  async function refreshAll() {
    try {
      await refreshStatus();
      await refreshLogs();
    } catch (error) {
      backendOnline = false;
      $("#backend-state").textContent = "BACKEND OFFLINE";
      $("#backend-detail").textContent = error.message + ". Запусти сервер командой npm start.";
      $("#backend-value").textContent = "OFFLINE";
      setPill("#backend-pill", "НЕТ СВЯЗИ", "warn");
      $("#settings-state").textContent = "Настройки backend недоступны. Открой приложение через локальный сервер.";
    }
  }
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
  $("#connect-api").addEventListener("click", async () => {\n    const candidate = $("#api-token").value.trim();\n    if (candidate.length < 32) { $("#api-auth-state").textContent = "Токен должен содержать не менее 32 символов."; return; }\n    apiToken = candidate;\n    $("#api-token").value = "";\n    try {\n      await refreshStatus();\n      await refreshLogs();\n      $("#api-auth-state").textContent = "Защищённый API подключён. Токен хранится только в памяти этой вкладки.";\n    } catch (error) {\n      apiToken = "";\n      $("#api-auth-state").textContent = "Проверка не пройдена: " + error.message + ". Токен очищен.";\n      await refreshAll();\n    }\n  });\n  $("#disconnect-api").addEventListener("click", async () => {\n    apiToken = "";\n    $("#api-auth-state").textContent = "Токен очищен из памяти вкладки.";\n    await refreshAll();\n  });\n  $("#start-bot").addEventListener("click", async () => {
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
  $("#refresh-log").addEventListener("click", () => refreshLogs().catch(error => renderLogs([{ at: new Date().toISOString(), event: "Ошибка загрузки журнала", details: { message: error.message } }])));
  refreshAll();
  setInterval(() => { if (backendOnline) refreshStatus().catch(() => { backendOnline = false; }); }, 5000);
})();