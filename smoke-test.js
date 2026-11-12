"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = __dirname;
const port = 19000 + (process.pid % 10000);
const base = `http://127.0.0.1:${port}`;
const token = "smoke-test-token-0123456789-abcdef";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chert-ai-smoke-"));
let child;

async function request(route, options = {}) {
  return fetch(base + route, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
}
async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Backend exited before becoming ready.");
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Backend did not become ready within 10 seconds.");
}
async function main() {
  child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: { ...process.env, CHERT_HOST: "127.0.0.1", PORT: String(port), CHERT_API_TOKEN: token, CHERT_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  try {
    await waitForServer();

    let response = await request("/", { redirect: "manual" });
    assert.equal(response.status, 302, "root route should redirect to index.html");
    assert.equal(response.headers.get("location"), "/index.html");

    response = await request("/index.html");
    assert.equal(response.status, 200, "index.html should be served");

    response = await request("/api/health");
    assert.equal(response.status, 200, "health endpoint should be public");

    response = await request("/api/status");
    assert.equal(response.status, 401, "protected API must reject missing token");

    const auth = { authorization: `Bearer ${token}` };
    response = await request("/api/settings", { headers: auth });
    assert.equal(response.status, 200, "settings should accept valid token");

    response = await request("/api/settings", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ notifications: false })
    });
    assert.equal(response.status, 200, "settings update should succeed");
    let payload = await response.json();
    assert.equal(payload.settings.notifications, false);

    response = await request("/api/bot/start", { method: "POST", headers: auth });
    assert.equal(response.status, 200, "worker should start");
    await new Promise(resolve => setTimeout(resolve, 300));
    response = await request("/api/status", { headers: auth });
    payload = await response.json();
    assert.equal(payload.bot.running, true, "worker should report running");

    response = await request("/api/bot/stop", { method: "POST", headers: auth });
    assert.equal(response.status, 200, "worker stop should be accepted");

    response = await request("/api/logs?limit=50", { headers: auth });
    assert.equal(response.status, 200, "audit log should be readable");
    payload = await response.json();
    assert.ok(payload.entries.some(entry => entry.event === "backend.started"));
    assert.ok(payload.entries.some(entry => entry.event === "settings.updated"));

    console.log("Smoke test passed: health, API auth, settings, worker lifecycle, audit log.");
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (child && child.exitCode !== 0 && child.exitCode !== null) {
      throw new Error(`Backend exited with code ${child.exitCode}. Output: ${output}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
