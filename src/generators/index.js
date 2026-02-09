// src/generators/index.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSegmentAssets } from "../utils/assets.js";
import { loadGlobalCss } from "../utils/css.js";

import { generate as svgGenerate } from "./svg-engine.js";
import { generate as htmlGenerate } from "./html-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load forms.json safely (no JSON import headaches)
const formsPath = path.join(__dirname, "../config/forms.json");
const forms = JSON.parse(fs.readFileSync(formsPath, "utf8"));


function resolveFormsKey(formId, segment) {
  const id = String(formId || "");
  let m = id.match(/^acord(\d+)$/i);
  if (m) return `ACORD${m[1]}`;
  if (/^supp_/i.test(id)) return "SUPP_CONTRACTOR";
  return id.toUpperCase();
}
function getFormConfigOrThrow(formId, segment) {
  if (!formId) {
    throw new Error(
      "[Factory] Missing form_id on requestRow. Set requestRow.form_id explicitly (e.g., acord25, acord125)."
    );
  }

  const cfg = forms[resolveFormsKey(formId)];

  if (!cfg) throw new Error(`[Factory] Configuration missing for form_id: ${formId}`);
  if (cfg.enabled === false) throw new Error(`[Factory] Form ${formId} is disabled.`);

  const engine = String(cfg.engine || "").toLowerCase();
  if (engine !== "svg" && engine !== "html") {
    throw new Error(`[Factory] Unknown engine type for ${formId}: ${cfg.engine}`);
  }

  if (!cfg.templatePath || typeof cfg.templatePath !== "string") {
    throw new Error(`[Factory] Missing templatePath for form_id: ${formId}`);
  }

  return { ...cfg, engine };
}

export async function generateDocument(requestRow) {
  const formId = requestRow?.form_id; // NO FALLBACK. Prevents wrong-template routing.
  const formConfig = getFormConfigOrThrow(formId, requestRow?.segment);

  const assets = getSegmentAssets(requestRow?.segment);

  const jobData = {
    requestRow,
    assets,
    templatePath: formConfig.templatePath,
    globalCss: null,
  };

  console.log(
    `[Factory] id=${requestRow?.id} form_id=${formId} seg=${requestRow?.segment || "default"} engine=${formConfig.engine} templatePath=${formConfig.templatePath}`
  );

  if (formConfig.engine === "svg") {
    return await svgGenerate(jobData);
  }

  // html
  jobData.globalCss = loadGlobalCss();
  return await htmlGenerate(jobData);
}

