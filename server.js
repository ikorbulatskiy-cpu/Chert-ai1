"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const DATA_DIR = process.env.CHERT_DATA_DIR || path.join(ROOT, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const LOG_FILE = path.join(DATA_DIR, "audit.jsonl");
const IMPORT_FILE = path.join(DATA_DIR, "galaxy-imports.jsonl");
const PROCESSED_FILE = path.join(DATA_DIR, "galaxy-processed.jsonl");
const CONVERSATIONS_FILE = path.join(DATA_DIR, "galaxy-conversations.json");
const HOST = process.env.CHERT_HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || process.env.CHERT_PORT || 8787);
const TOKEN = process.env.CHERT_API_TOKEN || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const DEFAULTS = { messageMonitoring: false, autoReply: false, notifications: true };
const GALAXY_ORIGIN = "https://galaxy.mobstudio.ru";

const isLoopbackHost = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("Invalid PORT: expected an integer from 1 to 65535.");
  process.exit(1);
}
if (!isLoopbackHost && TOKEN.length < 32) {
  console.error("Refusing public bind: set CHERT_API_TOKEN to a secret of at least 32 characters.");
  process.exit(1);
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml" };

fs.mkdirSync(DATA_DIR, { recursive: true });
let settings = loadSettings();
let bot = { running: false, startedAt: null, heartbeatAt: null, pid: null };
let botProcess = null;
let galaxy = { state: "not_checked", checkedAt: null, httpStatus: null, detail: "Внешний сайт ещё не проверялся." };
const hits = new Map();

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}
function persistSettings() {
  const temp = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(temp, SETTINGS_FILE);
}
function audit(event, details = {}) {
  const row = { id: crypto.randomUUID(), at: new Date().toISOString(), event, details };
  fs.appendFileSync(LOG_FILE, JSON.stringify(row) + "\n", { mode: 0o600 });
  return row;
}
function readJsonLines(file, limit = 100) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-limit).reverse().map(line => JSON.parse(line));
  } catch { return []; }
}
function readLogs(limit = 100) {
  return readJsonLines(LOG_FILE, limit);
}
function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extraHeaders });
  res.end(JSON.stringify(body));
}
function corsHeaders(req) {
  if (req.headers.origin !== GALAXY_ORIGIN) return {};
  return {
    "access-control-allow-origin": GALAXY_ORIGIN,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    "vary": "Origin"
  };
}
function authorized(req) {
  if (!TOKEN) return isLoopbackHost;
  const supplied = req.headers.authorization || "";
  const expected = "Bearer " + TOKEN;
  return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
function rateAllowed(ip) {
  const now = Date.now();
  const item = hits.get(ip) || { start: now, count: 0 };
  if (now - item.start > 60_000) { item.start = now; item.count = 0; }
  item.count++;
  hits.set(ip, item);
  return item.count <= 120;
}
async function bodyJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw Object.assign(new Error("Тело запроса слишком большое"), { status: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("Некорректный JSON"), { status: 400 }); }
}
function statusPayload() {
  return {
    ok: true,
    service: "Chert AI",
    backend: "online",
    bot: { ...bot, uptimeSeconds: bot.startedAt ? Math.floor((Date.now() - Date.parse(bot.startedAt)) / 1000) : 0 },
    settings,
    galaxy,
    integration: { mode: "manual_visible_text", authenticated: false, profile: "manual_import_only", messages: "manual_import_only", note: "Нет подтверждённого интерфейса Galaxy для чтения и отправки. Доступен только пользовательский импорт текста." },
    ai: { configured: Boolean(OPENAI_API_KEY), model: OPENAI_MODEL },
    time: new Date().toISOString()
  };
}
function cleanGalaxyText(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .replace(/javascript\s*:[\s\S]*$/gi, "")
    .split("\n")
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      if (/^(https?:\/\/|www\.)\S+$/i.test(line)) return false;
      if (/^data:image\//i.test(line)) return false;
      if (/^(?:const|let|var)\s+\w+\s*=|^\(?\s*\(\s*\)\s*=>|^fetch\s*\(|^document\.|^window\.|^alert\s*\(/i.test(line)) return false;
      if (/^\{?\s*["']?(?:ok|error|status|backend)["']?\s*:/.test(line)) return false;
      if (/^https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?.*)?$/i.test(line)) return false;
      return true;
    })
    .join("\n")
    .trim();
}
function parseGalaxyText(raw) {
  const cleaned = cleanGalaxyText(raw);
  if (!cleaned) return [];
  const messages = [];
  const timed = /^\s*\[?(\d{1,2}:\d{2})\]?\s+([^:]{1,60}):\s*(.+)$/;
  const named = /^\s*([^:]{1,60}):\s*(.+)$/;
  const looksLikeCode = line => /(?:=>|\b(?:function|async|await|return)\b|[{};]{2,}|document\.|window\.|fetch\()/i.test(line);
  const plausibleSender = value => { const v=value.trim().replace(/\s+/g," "); return v.length>=2&&v.length<=40&&!/^https?$/i.test(v)&&!/^(?:не определён|сообщение|чат|galaxy|система|system)$/i.test(v)&&!/^\d{1,2}:\d{2}$/.test(v)&&!/[<>]/.test(v); };
  for (const rawLine of cleaned.split("\n")) {
    const line=rawLine.trim(); if(!line||looksLikeCode(line))continue;
    let match=line.match(timed),time=null; if(match)time=match[1];else match=line.match(named);
    if(match){const sender=(time?match[2]:match[1]).trim().replace(/\s+/g," ").slice(0,60),body=(time?match[3]:match[2]).trim();if(plausibleSender(sender)&&body){messages.push({sender,time,text:body.slice(0,4000),senderDetected:true});continue;}}
    if(messages.length&&!/^https?:\/\//i.test(line))messages[messages.length-1].text=(messages[messages.length-1].text+"\n"+line).slice(0,4000);
    else if(!/^https?:\/\//i.test(line))messages.push({sender:"Не определён",time:null,text:line.slice(0,4000),senderDetected:false});
  }
  return messages.filter(m=>m.text.trim()).slice(0,100);
}
function loadConversations(){try{const v=JSON.parse(fs.readFileSync(CONVERSATIONS_FILE,"utf8"));return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}catch{return {};}}
function saveConversations(v){const t=CONVERSATIONS_FILE+".tmp";fs.writeFileSync(t,JSON.stringify(v),{mode:0o600});fs.renameSync(t,CONVERSATIONS_FILE);}
function normalizeConversationKey(v){return String(v||"").normalize("NFKC").trim().replace(/\s+/g," ").slice(0,60)||"Без имени";}
function appendConversation(key,name,messages,importId){const all=loadConversations(),c=all[key]||{key,characterName:name,updatedAt:null,messages:[]};for(const m of messages)c.messages.push({sender:m.sender,text:m.text,time:m.time||null,at:new Date().toISOString(),importId});c.messages=c.messages.slice(-200);c.updatedAt=new Date().toISOString();c.characterName=name||c.characterName||key;all[key]=c;saveConversations(all);return c;}
function suggestReplies(message) {
  const text = String(message.text || "").toLowerCase();
  if (/привет|здравствуй|добрый день|доброе утро|хай/.test(text)) return ["Привет! Как проходит твой день? 🙂", "Привет! Рад тебя видеть. Как дела?"];
  if (/как дела|как ты|как настроение/.test(text)) return ["Всё нормально, спасибо 🙂 А у тебя как?", "У меня всё хорошо. Чем сейчас занимаешься?"];
  if (/сколько лет|возраст/.test(text)) return ["Могу рассказать о себе. А ты чем увлекаешься?", "А как думаешь? 🙂"];
  if (/откуда|где жив[её]шь|город/.test(text)) return ["Я живу в своём городе. А ты откуда?", "А ты из какого города?"];
  if (/пока|спокойной ночи|до встречи/.test(text)) return ["До встречи! Хорошего тебе дня 🙂", "Пока! Буду рад продолжить общение."];
  if (/\?$/.test(text)) return ["Интересный вопрос. Расскажи немного подробнее 🙂", "Хочу понять тебя точнее. Что ты имеешь в виду?"];
  return ["Понял тебя 🙂 Расскажи об этом чуть подробнее.", "Интересно. И что было дальше?", "Понимаю 🙂 А как ты сам к этому относишься?"];
}
async function generateAiReply(messages, history = [], importId = "unknown") {
  if (!OPENAI_API_KEY) return null;
  const transcript = [...history.slice(-20), ...messages].slice(-40).map(m => `${m.sender}: ${m.text}`).join("\\n");
  const startedAt = Date.now();
  audit("openai.request_started", { importId, model: OPENAI_MODEL, messageCount: messages.length, historyCount: history.length });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "authorization": "Bearer " + OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: "Ты помощник пользователя в дружеской переписке. Пиши естественно по-русски, коротко, без выдумывания биографических фактов и без давления. Учитывай контекст диалога. Верни только текст одного подходящего ответа.",
      input: transcript,
      max_output_tokens: 180
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { audit("openai.request_failed", { importId, model: OPENAI_MODEL, status: response.status, durationMs: Date.now()-startedAt }); throw Object.assign(new Error("AI provider returned HTTP " + response.status), { status: 502 }); }
  const output = (data.output || []).flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join("\\n").trim();
  if(output)audit("openai.request_succeeded",{importId,model:OPENAI_MODEL,durationMs:Date.now()-startedAt,outputCharacters:output.length});else audit("openai.empty_response",{importId,model:OPENAI_MODEL,durationMs:Date.now()-startedAt});
  return output || null;
}
function processImport(entry, characterName = "") {
  const messages = parseGalaxyText(entry.text);
  const lastIncoming = [...messages].reverse().find(message => !/^(я|me|you)$/i.test(message.sender.trim()));
  return {
    id: crypto.randomUUID(),
    importId: entry.id,
    at: new Date().toISOString(),
    source: entry.source,
    pageTitle: entry.pageTitle,
    messages,
    messageCount: messages.length,
    characterName: normalizeConversationKey(characterName || entry.characterName || ""),
    conversationKey: normalizeConversationKey(characterName || entry.characterName || ""),
    replyDraft: lastIncoming ? { forMessage: lastIncoming.text, text: suggestReplies(lastIncoming)[0], options: suggestReplies(lastIncoming), status: "draft_only" } : null,
    note: "Распознавание эвристическое. Черновик не отправляется в Galaxy."
  };
}
async function checkGalaxy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(GALAXY_ORIGIN + "/web/", {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "ChertAI-AvailabilityCheck/1.0" }
    });
    galaxy = {
      state: response.ok ? "reachable" : "http_error",
      checkedAt: new Date().toISOString(),
      httpStatus: response.status,
      detail: response.ok ? "Публичная страница ответила. Это не означает вход в игровой аккаунт." : "Сайт ответил HTTP " + response.status + ". Авторизация не выполнялась."
    };
    audit("galaxy.public_page_checked", { state: galaxy.state, httpStatus: response.status });
  } catch (error) {
    galaxy = { state: "unavailable", checkedAt: new Date().toISOString(), httpStatus: null, detail: error.name === "AbortError" ? "Проверка превысила лимит времени." : "Не удалось получить ответ от публичной страницы." };
    audit("galaxy.public_page_check_failed", { error: error.name || "NetworkError" });
  } finally { clearTimeout(timeout); }
  return galaxy;
}

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (!rateAllowed(ip)) return send(res, 429, { error: "Слишком много запросов" });
  const url = new URL(req.url, "http://localhost");
  const isGalaxyImport = url.pathname === "/api/galaxy/import";
  const cors = isGalaxyImport ? corsHeaders(req) : {};

  if (isGalaxyImport && req.method === "OPTIONS") {
    if (!req.headers.origin || req.headers.origin !== GALAXY_ORIGIN) return send(res, 403, { error: "Origin not allowed" });
    res.writeHead(204, cors);
    return res.end();
  }
  try {
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health" && !authorized(req)) {
      audit("security.unauthorized_request", { method: req.method, path: url.pathname });
      return send(res, 401, { error: "Требуется корректный API-токен" }, cors);
    }
    if (url.pathname === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, backend: "online" });
    if (url.pathname === "/api/status" && req.method === "GET") return send(res, 200, statusPayload());
    if (url.pathname === "/api/settings" && req.method === "GET") return send(res, 200, { settings });
    if (url.pathname === "/api/settings" && req.method === "PUT") {
      const input = await bodyJson(req);
      for (const key of Object.keys(DEFAULTS)) if (typeof input[key] === "boolean") settings[key] = input[key];
      persistSettings();
      audit("settings.updated", { settings });
      return send(res, 200, { ok: true, settings });
    }
    if (url.pathname === "/api/bot/start" && req.method === "POST") {
      if (!botProcess) {
        botProcess = spawn(process.execPath, [path.join(ROOT, "bot-worker.js")], {
          cwd: ROOT, stdio: ["ignore", "ignore", "ignore", "ipc"],
          env: { ...process.env, CHERT_BOT_WORKER: "1" }
        });
        bot = { running: true, startedAt: new Date().toISOString(), heartbeatAt: null, pid: botProcess.pid };
        audit("bot.process_started", { pid: botProcess.pid });
        botProcess.on("message", message => {
          if (message && message.type === "heartbeat") bot.heartbeatAt = message.at;
        });
        botProcess.on("error", error => {
          audit("bot.process_error", { message: error.message });
          bot = { running: false, startedAt: null, heartbeatAt: null, pid: null };
          botProcess = null;
        });
        botProcess.on("exit", (code, signal) => {
          audit("bot.process_exited", { code, signal });
          bot = { running: false, startedAt: null, heartbeatAt: null, pid: null };
          botProcess = null;
        });
      }
      return send(res, 200, { ok: true, bot });
    }
    if (url.pathname === "/api/bot/stop" && req.method === "POST") {
      if (botProcess) {
        const child = botProcess;
        botProcess = null;
        child.kill("SIGTERM");
        audit("bot.process_stop_requested", { pid: child.pid });
      }
      bot = { running: false, startedAt: null, heartbeatAt: null, pid: null };
      return send(res, 200, { ok: true, bot });
    }
    if (url.pathname === "/api/galaxy/check" && req.method === "POST") return send(res, 200, { ok: true, galaxy: await checkGalaxy() });
    if (isGalaxyImport && req.method === "POST") {
      const input = await bodyJson(req);
      const rawContent = typeof input.text === "string" ? input.text.trim() : "";
      const content = cleanGalaxyText(rawContent);
      if (!content || content.length > 8000) return send(res, 400, { error: "Выделенный текст должен содержать от 1 до 8000 символов" }, cors);
      const pageUrl = typeof input.pageUrl === "string" && input.pageUrl.startsWith(GALAXY_ORIGIN + "/") ? input.pageUrl.slice(0, 500) : GALAXY_ORIGIN + "/web/";
      const characterName = typeof input.characterName === "string" ? input.characterName.trim().slice(0,60) : "";
      const entry = {
        characterName,
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        source: "manual_paste",
        pageTitle: typeof input.pageTitle === "string" ? input.pageTitle.slice(0, 200) : "Galaxy",
        pageUrl,
        text: content
      };
      fs.appendFileSync(IMPORT_FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
      audit("galaxy.user_text_imported", { characters: content.length, removedCharacters: rawContent.length - content.length, pageUrl });
      return send(res, 201, { ok: true, imported: { id: entry.id, characters: content.length, at: entry.at } }, cors);
    }
    if (url.pathname === "/api/galaxy/process" && req.method === "POST") {
      const input = await bodyJson(req);
      const imports = readJsonLines(IMPORT_FILE, 1000);
      const processed = readJsonLines(PROCESSED_FILE, 1000);
      const known = new Set(processed.map(item => item.importId));
      const entry = input.importId
        ? imports.find(item => item.id === input.importId)
        : imports.find(item => !known.has(item.id));
      if (!entry) return send(res, 404, { error: "Нет нового импорта для обработки" });
      if (known.has(entry.id)) return send(res, 200, { ok: true, alreadyProcessed: true, processed: processed.find(item => item.importId === entry.id) });
      const characterName=normalizeConversationKey(input.characterName||entry.characterName||"");
      const result=processImport(entry,characterName);
      const previous=loadConversations()[result.conversationKey];
      const history=previous?previous.messages:[];
      let aiText=null,aiError=null;
      if(OPENAI_API_KEY&&result.replyDraft){try{aiText=await generateAiReply(result.messages,history,entry.id);}catch(error){aiError=error.message;audit("openai.fallback_used",{importId:entry.id,reason:error.message});}}
      const source=aiText?"openai":result.replyDraft?"template":"none";
      if(result.replyDraft){if(aiText){result.replyDraft.text=aiText;result.replyDraft.options=[aiText];}result.replyDraft.provider=source;result.replyDraft.sourceLabel=source==="openai"?"OpenAI":"Шаблон";}
      result.ai={configured:Boolean(OPENAI_API_KEY),used:Boolean(aiText),source,model:OPENAI_MODEL,error:aiError};
      const conversation=appendConversation(result.conversationKey,characterName,result.messages,entry.id);
      result.conversationMessageCount=conversation.messages.length;
      fs.appendFileSync(PROCESSED_FILE, JSON.stringify(result) + "\n", { mode: 0o600 });
      audit("galaxy.import_processed", { importId: entry.id, messages: result.messageCount, hasReplyDraft: Boolean(result.replyDraft), replySource: source, conversationKey: result.conversationKey });
      return send(res, 201, { ok: true, processed: result });
    }
    if (url.pathname === "/api/galaxy/conversations" && req.method === "GET") {
      const entries=Object.values(loadConversations()).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return send(res,200,{entries});
    }
    if (url.pathname === "/api/galaxy/processed" && req.method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
      return send(res, 200, { entries: readJsonLines(PROCESSED_FILE, limit) });
    }
    if (url.pathname === "/api/galaxy/imports" && req.method === "GET") {
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
      return send(res, 200, { entries: readJsonLines(IMPORT_FILE, limit) });
    }
    if (url.pathname === "/api/logs" && req.method === "GET") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      return send(res, 200, { entries: readLogs(limit) });
    }
    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "API endpoint не найден" });

    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(302, { location: "/index.html", "cache-control": "no-store" });
      return res.end();
    }

    const requested = decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, "." + requested);
    if (!file.startsWith(ROOT + path.sep)) return send(res, 403, { error: "Forbidden" });
    fs.readFile(file, (error, data) => {
      if (error) return send(res, 404, { error: "Файл не найден" });
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "x-content-type-options": "nosniff" });
      res.end(data);
    });
  } catch (error) {
    audit("api.error", { message: error.message, path: url.pathname });
    send(res, error.status || 500, { error: error.status ? error.message : "Внутренняя ошибка сервера" }, cors);
  }
});

server.listen(PORT, HOST, () => {
  audit("backend.started", { host: HOST, port: PORT });
  console.log("Chert AI backend listening on http://" + HOST + ":" + PORT);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  audit("backend.stopping", { signal });
  if (botProcess) botProcess.kill("SIGTERM");
  server.close(() => process.exit(0));
});
