import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.PORT || 3010);
const token = String(process.env.CODEX_BRIDGE_TOKEN || "");
const maxConcurrency = Math.max(1, Number(process.env.CODEX_MAX_CONCURRENCY || 1));
const timeoutMs = Math.max(10_000, Number(process.env.CODEX_TIMEOUT_MS || 180_000));
const maxBodyBytes = Math.max(1024, Number(process.env.CODEX_MAX_BODY_BYTES || 262_144));

if (!token) {
  console.error("CODEX_BRIDGE_TOKEN is required.");
  process.exit(1);
}

let activeRuns = 0;

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function isAuthorized(req) {
  return req.headers.authorization === `Bearer ${token}`;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || "/workspace",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs || timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error(`Codex timed out after ${options.timeoutMs || timeoutMs} ms.`);
        error.statusCode = 504;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runCodex({ prompt, schema }) {
  const work = await mkdtemp(join(tmpdir(), "codex-bridge-"));
  const outputPath = join(work, "result.txt");
  const args = ["exec"];

  try {
    if (schema !== undefined) {
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        const error = new Error("schema must be a JSON Schema object.");
        error.statusCode = 400;
        throw error;
      }

      const schemaPath = join(work, "schema.json");
      await writeFile(schemaPath, JSON.stringify(schema), "utf8");
      args.push("--output-schema", schemaPath);
    }

    args.push("-o", outputPath, prompt);

    const result = await runProcess("codex", args);

    if (result.code !== 0) {
      const error = new Error("Codex execution failed.");
      error.statusCode = 502;
      error.details = result.stderr.trim() || result.stdout.trim();
      throw error;
    }

    const output = (await readFile(outputPath, "utf8")).trim();
    let structuredOutput = null;

    if (schema !== undefined) {
      try {
        structuredOutput = JSON.parse(output);
      } catch {
        const error = new Error("Codex returned output that does not match the requested JSON format.");
        error.statusCode = 502;
        error.details = output;
        throw error;
      }
    }

    return {
      output,
      structuredOutput,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function codexStatus() {
  const result = await runProcess("codex", ["login", "status"], { timeoutMs: 20_000 });
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim(),
  };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, {
        ok: true,
        activeRuns,
        maxConcurrency,
      });
      return;
    }

    if (!isAuthorized(req)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      const status = await codexStatus();
      json(res, status.ok ? 200 : 503, status);
      return;
    }

    if (req.method === "POST" && req.url === "/run") {
      if (activeRuns >= maxConcurrency) {
        json(res, 429, {
          ok: false,
          error: "busy",
          message: "Codex bridge concurrency limit reached.",
        });
        return;
      }

      const body = await readJsonBody(req);
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

      if (!prompt) {
        json(res, 400, { ok: false, error: "prompt is required" });
        return;
      }

      activeRuns += 1;
      try {
        const result = await runCodex({ prompt, schema: body.schema });
        json(res, 200, { ok: true, ...result });
      } finally {
        activeRuns -= 1;
      }
      return;
    }

    json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    json(res, statusCode, {
      ok: false,
      error: error.message || "Internal error",
      details: error.details || undefined,
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`codex-bridge listening on :${port}`);
});
