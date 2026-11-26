import { execSync } from "node:child_process";
import fs from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : def; };

const TOKEN = process.env.GATEWAY_TOKEN;
if (!TOKEN) { console.error("Set $env:GATEWAY_TOKEN first"); process.exit(1); }
const BASE = process.env.GATEWAY_URL || "http://127.0.0.1:18789";
const CONTAINER = process.env.CONTAINER || "openclaw-openclaw-gateway-1";
const RUNS = Number(opt("runs", "3"));
const PARALLEL = Number(opt("parallel", "5"));
const MODELS = opt("models", "default").split(",");
const LABEL = opt("label", "run");
const SERIAL = Date.now().toString(36);

const sec = (ms) => (ms / 1000).toFixed(1);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fmt = (ms) => (Number.isNaN(ms) ? "n/a" : sec(ms) + "s");

async function ask(prompt, model, user) {
  const t0 = Date.now();
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  if (model !== "default") headers["x-openclaw-model"] = model;
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "openclaw/default", user, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(240000),
    });
    const body = await res.text();
    if (!res.ok) return { ms: Date.now() - t0, ok: false, error: `HTTP ${res.status}: ${body.slice(0, 150)}` };
    return { ms: Date.now() - t0, ok: true };
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, error: String(e.message || e) };
  }
}

function inMcpFolder(name) {
  try {
    execSync(`docker exec ${CONTAINER} test -f /home/node/mcp-tools/files/${name}`, { stdio: "ignore" });
    return true;
  } catch { return false; }
}

const toolPrompt = (id) =>
  `Use the tool local-tools__create_file to create the file bench_${id}.txt with the content ok. Then reply with one short sentence.`;

async function benchModel(model) {
  const res = { model, simple: [], tool: [], toolViaMcp: 0, toolRuns: RUNS, parallel: null, errors: [] };
  console.log(`\n=== Model: ${model} ===`);

  for (let i = 1; i <= RUNS; i++) {
    const r = await ask("Reply with exactly one word: OK", model, `bench:${SERIAL}:${LABEL}:a${i}`);
    console.log(`  simple #${i}: ${r.ok ? sec(r.ms) + "s" : "FAILED " + r.error}`);
    if (r.ok) res.simple.push(r.ms); else res.errors.push(r.error);
  }

  for (let i = 1; i <= RUNS; i++) {
    const id = `${SERIAL}_${LABEL}_t${i}`;
    const r = await ask(toolPrompt(id), model, `bench:${SERIAL}:${LABEL}:t${i}`);
    const viaMcp = r.ok && inMcpFolder(`bench_${id}.txt`);
    console.log(`  tool   #${i}: ${r.ok ? sec(r.ms) + "s" : "FAILED " + r.error}  file_in_mcp_folder=${viaMcp}`);
    if (r.ok) { res.tool.push(r.ms); if (viaMcp) res.toolViaMcp++; } else res.errors.push(r.error);
  }

  console.log(`  parallel: sending ${PARALLEL} tool tasks at once...`);
  const t0 = Date.now();
  const jobs = Array.from({ length: PARALLEL }, (_, i) => {
    const id = `${SERIAL}_${LABEL}_p${i}`;
    return ask(toolPrompt(id), model, `bench:${SERIAL}:${LABEL}:p${i}`).then((r) => ({ r, id }));
  });
  const done = await Promise.all(jobs);
  const wall = Date.now() - t0;
  const okCount = done.filter((d) => d.r.ok && inMcpFolder(`bench_${d.id}.txt`)).length;
  done.filter((d) => !d.r.ok).forEach((d) => res.errors.push(d.r.error));
  res.parallel = { n: PARALLEL, wallMs: wall, okCount };
  console.log(`  parallel: ${okCount}/${PARALLEL} succeeded in ${sec(wall)}s`);
  return res;
}

const all = [];
for (const m of MODELS) all.push(await benchModel(m));

try { execSync(`docker exec ${CONTAINER} sh -c "rm -f /home/node/mcp-tools/files/bench_*"`, { stdio: "ignore" }); } catch {}

console.log("\n==================== SUMMARY (" + LABEL + ") ====================");
for (const r of all) {
  const p = r.parallel;
  const perMin = p.okCount > 0 ? p.okCount / (p.wallMs / 60000) : NaN;
  const min1000 = Number.isNaN(perMin) ? NaN : 1000 / perMin;
  console.log(`Model: ${r.model}`);
  console.log(`  Simple question avg : ${fmt(avg(r.simple))}   (min ${fmt(Math.min(...r.simple))}, max ${fmt(Math.max(...r.simple))})`);
  console.log(`  Tool task avg       : ${fmt(avg(r.tool))}   file created via MCP: ${r.toolViaMcp}/${r.toolRuns}`);
  console.log(`  ${p.n} parallel tasks    : ${p.okCount}/${p.n} ok in ${sec(p.wallMs)}s  => ${Number.isNaN(perMin) ? "n/a" : perMin.toFixed(1)} tasks/min`);
  console.log(`  Estimate for 1000 tasks at this rate: ${Number.isNaN(min1000) ? "n/a" : min1000.toFixed(0) + " min (" + (min1000 / 60).toFixed(1) + " hours)"}`);
  if (r.errors.length) console.log(`  Errors: ${r.errors.length}  e.g. ${r.errors[0]}`);
}
fs.writeFileSync(`bench-results-${LABEL}.json`, JSON.stringify(all, null, 2));
console.log(`\nSaved: bench-results-${LABEL}.json`);
