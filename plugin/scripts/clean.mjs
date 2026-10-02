// Uso: node clean.mjs login   -> abre o Chrome para voce logar (uma vez)
//      node clean.mjs         -> limpa a biblioteca uma vez
//      node clean.mjs watch   -> limpa a cada config.everyHours horas
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const profileDir = join(homedir(), ".gpt-library-cleaner", "profile"); // fora do plugin: sobrevive a atualizacoes

const config = {
  url: "https://chatgpt.com/library?tab=all",
  maxPerRun: 100, // itens apagados por execucao
  everyHours: 24, // intervalo do modo watch
  dryRun: false, // true = so lista e conta, nao apaga
  olderThanDays: 15, // so apaga o que foi adicionado ha mais de N dias
  category: "image", // library_file_category a apagar; null = todas
  ...JSON.parse(readFileSync(join(dir, "config.json"), "utf8")),
};

const mode = process.argv[2];

const chromePath =
  config.chromePath ??
  ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
const PORT = 9222;

// Chrome comum (sem flags de automacao): o Google deixa logar nele. O Playwright so se conecta depois, via CDP.
const spawnChrome = (...extra) =>
  spawn(chromePath, [`--user-data-dir=${profileDir}`, "--no-first-run", ...extra], { stdio: "ignore" });

async function login() {
  const chrome = spawnChrome("https://chatgpt.com");
  console.log("Logue no ChatGPT (Google funciona) e feche o navegador.");
  await new Promise((r) => chrome.on("exit", r));
}

async function launch() {
  const chrome = spawnChrome(`--remote-debugging-port=${PORT}`, ...(config.headless ? ["--headless=new"] : [])); // headless cai no desafio do Cloudflare
  for (let i = 0; ; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; }
    catch { if (i > 30) throw new Error("Chrome nao iniciou (feche outras janelas dele que usem este perfil)."); await new Promise((r) => setTimeout(r, 500)); }
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  ctx.close = async () => { await browser.close(); chrome.kill(); };
  return ctx;
}

const API = "https://chatgpt.com/backend-api/files/library/files/delete-batch";
const BATCH = 20;
const SKIP_HEADERS = /^(:|cookie$|content-length$|host$|accept-encoding$)/i;

// acha, em qualquer JSON, arquivos da biblioteca (items de /files/library/nodes) que ainda nao estao no Lixo
function collect(node, found) {
  if (!node || typeof node !== "object") return;
  if (node.kind === "file" && String(node.id).startsWith("libfile_") && !node.trashed_at)
    found.set(node.id, {
      created: Date.parse(node.record_creation_time ?? node.updated_at),
      category: node.library_file_category,
      payload: {
        library_file_id: node.id,
        file_id: node.file_id,
        parent_directory_id: node.parent_directory_id,
        file_name: node.name,
      },
    });
  for (const v of Object.values(node)) collect(v, found);
}

async function clean() {
  const ctx = await launch();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const found = new Map();
  let headers; // copiados da propria pagina: token e ids nunca ficam em arquivo
  page.on("response", async (res) => {
    if (/delete-batch/.test(res.url())) return;
    try {
      if (!(res.headers()["content-type"] ?? "").includes("json")) return;
      const h = await res.request().allHeaders();
      if (h.authorization) headers ??= h;
      collect(await res.json(), found);
    } catch {}
  });
  try {
    await page.goto(config.url);
    await page.mouse.move(600, 400);
    const cutoff = Date.now() - config.olderThanDays * 86400_000;
    const eligible = () =>
      [...found.values()]
        .filter((f) => f.created < cutoff && (!config.category || f.category === config.category))
        .map((f) => f.payload);
    // rola ate parar de aparecer arquivos novos (a pagina carrega por demanda)
    for (let stable = 0; stable < 3 && eligible().length < config.maxPerRun; ) {
      const before = found.size;
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(1200);
      stable = found.size === before ? stable + 1 : 0;
    }
    if (!found.size) throw new Error("Nenhum arquivo encontrado (biblioteca vazia ou formato da API mudou).");
    const files = eligible().slice(0, config.maxPerRun);
    console.log(`${found.size} na biblioteca, ${files.length} com mais de ${config.olderThanDays} dias:`, files.map((f) => f.file_name));
    if (!files.length) return;
    if (config.dryRun) return;
    if (!headers) throw new Error("Nenhuma requisicao autenticada capturada; rode 'login' de novo.");
    const h = Object.fromEntries(Object.entries(headers).filter(([k]) => !SKIP_HEADERS.test(k)));
    for (let i = 0; i < files.length; i += BATCH) {
      const res = await ctx.request.post(API, { headers: h, data: { files: files.slice(i, i + BATCH) } });
      const body = await res.json();
      const failed = (body.files ?? []).filter((f) => !f.success);
      if (!res.ok() || failed.length) throw new Error(`delete-batch falhou: ${res.status()} ${JSON.stringify(failed)}`);
    }
    console.log(`${files.length} arquivos enviados para o Lixo.`);
  } catch (e) {
    await page.screenshot({ path: join(dir, "erro.png") });
    throw e; // sessao expirada ou formato da API mudou: veja erro.png
  } finally {
    await ctx.close();
  }
}

if (mode === "login") await login();
else if (mode === "watch") {
  const run = () => clean().catch((e) => console.error(e.message));
  await run();
  setInterval(run, config.everyHours * 3600_000);
} else await clean();
