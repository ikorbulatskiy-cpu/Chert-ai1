(() => {
  const $ = (selector) => document.querySelector(selector);
  const logList = $("#log-list");
  const keys = ["messageMonitoring", "autoReply", "notifications"];
  const defaults = { messageMonitoring: false, autoReply: false, notifications: true };
  let settings = { ...defaults };
  let entries = [];

  try {
    settings = { ...defaults, ...JSON.parse(localStorage.getItem("chert-ai-settings") || "{}") };
    entries = JSON.parse(localStorage.getItem("chert-ai-log") || "[]");
  } catch (_) {
    entries = [];
  }

  const timeNow = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function save() {
    try {
      localStorage.setItem("chert-ai-settings", JSON.stringify(settings));
      localStorage.setItem("chert-ai-log", JSON.stringify(entries.slice(0, 80)));
    } catch (_) { /* Private browsing may disable local storage. */ }
  }
  function addLog(message) {
    entries.unshift({ time: timeNow(), message });
    entries = entries.slice(0, 80);
    save();
    renderLog();
  }
  function renderLog() {
    logList.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "log-empty";
      empty.textContent = "Событий пока нет.";
      logList.append(empty);
      return;
    }
    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "log-entry";
      const time = document.createElement("span");
      time.className = "log-time";
      time.textContent = entry.time;
      const message = document.createElement("span");
      message.className = "log-message";
      message.textContent = entry.message;
      row.append(time, message);
      logList.append(row);
    });
  }

  document.querySelectorAll("[data-setting]").forEach((input) => {
    const key = input.dataset.setting;
    input.checked = Boolean(settings[key]);
    input.addEventListener("change", () => {
      settings[key] = input.checked;
      save();
      addLog((input.checked ? "Включена настройка: " : "Выключена настройка: ") + key);
      if (key === "autoReply" && input.checked) {
        addLog("Автоответы сохранены как настройка. Отправка сообщений пока не активна: нет подтверждённого API.");
      }
    });
  });

  function openOfficialSite() {
    const opened = window.open("https://galaxy.mobstudio.ru/web/", "_blank", "noopener,noreferrer");
    addLog("Запрошено открытие официального Galaxy of Dating.");
    if (!opened) addLog("Браузер заблокировал новую вкладку. Открой сайт по ссылке в верхней части страницы.");
  }
  $("#open-site").addEventListener("click", openOfficialSite);
  $("#clear-log").addEventListener("click", () => {
    entries = [];
    save();
    renderLog();
    addLog("Журнал очищен.");
  });

  renderLog();
  if (!entries.length) addLog("Панель ЧЁРТ AI загружена. Игровое подключение не подтверждено.");
  keys.forEach((key) => {
    if (!(key in settings)) settings[key] = defaults[key];
  });
})();