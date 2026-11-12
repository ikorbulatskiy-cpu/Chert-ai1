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
  async function refreshConversations(){const data=await api("/api/galaxy/conversations"),target=$("#conversation-list");target.replaceChildren();if(!(data.entries||[]).length){const e=document.createElement("p");e.className="log-empty";e.textContent="История появится после импорта сообщений с указанным персонажем.";target.append(e);return;}data.entries.forEach(c=>{const card=document.createElement("article");card.className="processed-card";const title=document.createElement("b");title.textContent=c.characterName||c.key||"Без имени";card.append(title);const meta=document.createElement("p");meta.textContent="Обновлено: "+new Date(c.updatedAt).toLocaleString("ru-RU")+" · сообщений: "+(c.messages||[]).length;card.append(meta);(c.messages||[]).slice(-12).forEach(m=>{const row=document.createElement("div");row.className="parsed-message";const who=document.createElement("strong");who.textContent=m.sender||"Не определён";const body=document.createElement("div");body.textContent=m.text;row.append(who,body);card.append(row);});target.append(card);});}
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
      const source=item.ai&&item.ai.source==="openai"?"OpenAI":item.ai&&item.ai.source==="template"?"Шаблон":"Нет ответа";
      meta.textContent = new Date(item.at).toLocaleString("ru-RU") + " · распознано сообщений: " + item.messageCount + " · источник ответа: " + source;
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
        label.textContent = "Черновик ответа · источник: " + (item.replyDraft.sourceLabel || "Шаблон") + " · не отправлен";
        const content = document.createElement("p");
        content.textContent = item.replyDraft.text;
        draft.append(label, content);
        const choices = Array.isArray(item.replyDraft.options) ? item.replyDraft.options : [item.replyDraft.text];
        choices.slice(0, 3).forEach((choice, index) => {
          const option = document.createElement("div");
          option.className = "reply-option";
          const text = document.createElement("p");
          text.textContent = (index + 1) + ". " + choice;
          const copy = document.createElement("button");
          copy.type = "button";
          copy.className = "button button-secondary";
          copy.textContent = "Скопировать";
          copy.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(choice);
              copy.textContent = "Скопировано";
            } catch {
              text.textContent = choice + " (выдели и скопируй вручную)";
            }
          });
          option.append(text, copy);
          draft.append(option);
        });
        card.append(draft);
      }
      processedList.append(card);
    });
  }
  async function refreshStatus() {
    const data = await api("/api/status");
    backendOnline = true;
    $("#backend-state").textContent = "BACKEND ONLINE";
    $("#backend-detail").textContent = "Сервер отвечает · " + new Date(data.time).toLocaleTimeString("ru-RU") + " · ИИ: " + (data.ai && data.ai.configured ? data.ai.model : "не настроен");
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
    document.querySelectorAll("[data-setting]").forEach(input => { input.checked = input.disabled ? false : Boolean(settings[input.dataset.setting]); });
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
      await Promise.all([refreshLogs(), refreshImports(), refreshProcessed(), refreshConversations()]);
    } catch (error) {
      backendOnline = false;
      $("#backend-state").textContent = "BACKEND OFFLINE";
      $("#backend-detail").textContent = error.message + ". Сервер недоступен.";
      $("#backend-value").textContent = "OFFLINE";
      setPill("#backend-pill", "НЕТ СВЯЗИ", "warn");
      $("#settings-state").textContent = "Настройки backend недоступны.";
    }
  }

  const bookmarkletSource = `javascript:(()=>{if(location.origin!=="https://galaxy.mobstudio.ru"){alert("Открой официальный Galaxy.");return;}const text=(window.getSelection&&window.getSelection().toString()||"").trim();if(!text){alert("Сначала выдели текст сообщений.");return;}const token=prompt("Вставь API-токен Chert AI. Он не будет сохранён.");if(!token)return;fetch("https://chert-ai1.onrender.com/api/galaxy/import",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({text,pageTitle:document.title,pageUrl:location.href})}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"HTTP "+r.status);alert("Импортировано: "+d.imported.characters+" символов. Вернись в Chert AI и обработай импорт.");}).catch(e=>alert("Ошибка импорта: "+e.message));})();`;
  $("#bookmarklet-code").value = bookmarkletSource;
  $("#copy-bookmarklet").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletSource);
      $("#bookmarklet-state").textContent = "Код скопирован. Создай закладку Safari и вставь код в поле адреса.";
    } catch {
      $("#bookmarklet-code").focus();
      $("#bookmarklet-code").select();
      $("#bookmarklet-state").textContent = "Автокопирование недоступно. Выдели код в поле и скопируй вручную.";
    }
  });
  const replyBookmarkletSource = `javascript:(()=>{if(location.origin!=="https://galaxy.mobstudio.ru"){alert("Открой официальный Galaxy.");return;}const reply=prompt("Вставь готовый ответ из Chert AI. Закладка только заполнит поле, отправка останется за тобой.");if(reply===null||!reply.trim())return;const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=="hidden"&&s.display!=="none";};const active=document.activeElement;const valid=e=>e&&((e.matches&&e.matches("textarea,input:not([type]),input[type=text],input[type=search]"))&&!e.disabled&&!e.readOnly||e.isContentEditable);let target=valid(active)&&visible(active)?active:null;if(!target){const candidates=[...document.querySelectorAll("textarea,input:not([type]),input[type=text],input[type=search],[contenteditable=true]")].filter(e=>valid(e)&&visible(e));if(candidates.length===1)target=candidates[0];}if(!target){alert("Не удалось однозначно найти поле сообщения. Нажми на поле ввода в Galaxy и запусти закладку ещё раз.");return;}target.focus();if(target.isContentEditable){target.textContent=reply;}else{const setter=Object.getOwnPropertyDescriptor(target.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set;setter.call(target,reply);}target.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:reply}));target.dispatchEvent(new Event("change",{bubbles:true}));alert("Черновик вставлен в поле Galaxy. Проверь текст и нажми «Отправить» самостоятельно.");})();`;
  $("#reply-bookmarklet-code").value = replyBookmarkletSource;
  $("#copy-reply-bookmarklet").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(replyBookmarkletSource);
      $("#reply-bookmarklet-state").textContent = "Закладка скопирована. Сохрани её в Safari так же, как первую.";
    } catch {
      $("#reply-bookmarklet-code").focus();
      $("#reply-bookmarklet-code").select();
      $("#reply-bookmarklet-state").textContent = "Выдели код в поле и скопируй вручную.";
    }
  });

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
          characterName: $("#character-name").value.trim(),
          pageTitle: "Ручной импорт из Galaxy",
          pageUrl: "https://galaxy.mobstudio.ru/web/"
        })
      });
      $("#bridge-state").textContent = "Импортировано " + result.imported.characters + " символов. Данные сохранены на backend.";
      $("#galaxy-text").value = "";
      $("#galaxy-char-count").textContent = "0 / 8000";
      const processed = await api("/api/galaxy/process", { method: "POST", body: JSON.stringify({}) });
      $("#bridge-state").textContent += " Обработано сообщений: " + processed.processed.messageCount + ".";
      await Promise.all([refreshImports(), refreshLogs(), refreshProcessed(), refreshConversations()]);
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
  $("#refresh-conversations").addEventListener("click", () => refreshConversations().catch(error => { $("#conversation-list").textContent = "Ошибка загрузки истории: " + error.message; }));
  $("#process-imports").addEventListener("click", async () => {
    const button = $("#process-imports");
    button.disabled = true;
    button.textContent = "Обработка…";
    try {
      const result = await api("/api/galaxy/process", { method: "POST", body: JSON.stringify({}) });
      $("#processing-state").textContent = "Распознано сообщений: " + result.processed.messageCount + ". " + (result.processed.ai && result.processed.ai.used ? "Ответ сгенерирован ИИ (" + result.processed.ai.model + ")." : "ИИ не настроен, использован резервный шаблон.") + " Черновик не отправлен.";
      await Promise.all([refreshProcessed(),refreshConversations()]);
    } catch (error) {
      $("#processing-state").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Обработать новый импорт";
    }
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(error => {
      console.warn("PWA service worker registration failed:", error);
    }));
  }
  refreshAll();
  setInterval(() => {
    if (!backendOnline) return;
    if (apiToken) refreshStatus().catch(() => { backendOnline = false; });
    else refreshAll();
  }, 15000);
})();