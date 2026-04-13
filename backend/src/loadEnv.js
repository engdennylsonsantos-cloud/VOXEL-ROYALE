import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function loadLocalEnv() {
  const currentFile = fileURLToPath(import.meta.url);
  const backendRoot = path.resolve(path.dirname(currentFile), "..");
  const envPath = path.join(backendRoot, ".env");

  if (!fs.existsSync(envPath)) {
    console.warn(`[env] Arquivo .env nao encontrado em ${envPath}`);
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const entry = parseLine(line);
    if (!entry || process.env[entry.key]) {
      continue;
    }

    process.env[entry.key] = entry.value;
  }
}
