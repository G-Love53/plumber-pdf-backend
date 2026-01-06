// src/services/endorsements/endorsementLoader.js
import fs from "fs";
import path from "path";

let _cache = null;

function readJsonOrThrow(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Bible file missing: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e.message}`);
  }
}

export function loadEndorsementBible({ forceReload = false } = {}) {
  if (_cache && !forceReload) return _cache;

  // Repo root in Render = process.cwd()
  const repoRoot = process.cwd();

  const catalogPath = path.join(
    repoRoot,
    "bible",
    "04_ENDORSEMENTS",
    "endorsement_catalog.json"
  );

  const rulesPath = path.join(
    repoRoot,
    "bible",
    "04_ENDORSEMENTS",
    "endorsement_rules.json"
  );

  const catalog = readJsonOrThrow(catalogPath);
  const rules = readJsonOrThrow(rulesPath);

  if (!catalog?.endorsements || !Array.isArray(catalog.endorsements)) {
    throw new Error("endorsement_catalog.json must contain endorsements[]");
  }
  if (!rules?.rules || !Array.isArray(rules.rules)) {
    throw new Error("endorsement_rules.json must contain rules[]");
  }

  // Build fast lookup maps
  const byCode = new Map();
  const aliasToCode = new Map();

  for (const e of catalog.endorsements) {
    if (!e?.code) continue;
    const code = String(e.code).trim();
    byCode.set(code, e);

    const aliases = Array.isArray(e.aliases) ? e.aliases : [];
    // Include code itself as a match token
    const all = [code, ...aliases];

    for (const a of all) {
      const key = String(a).trim().toLowerCase();
      if (!key) continue;
      // If duplicates exist, first wins (stable)
      if (!aliasToCode.has(key)) aliasToCode.set(key, code);
    }
  }

  _cache = {
    catalog,
    rules,
    byCode,
    aliasToCode,
    loadedAt: new Date().toISOString(),
    paths: { catalogPath, rulesPath }
  };

  return _cache;
}

export function getEndorsementBible() {
  return loadEndorsementBible();
}
