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

export async function generateDocument(requestRow) {
  const formId = requestRow.form_id || "acord25_v1";
  const formConfig = forms[formId];

  if (!formConfig) throw new Error(`Configuration missing for form_id: ${formId}`);
  if (formConfig.enabled === false) throw new Error(`Form ${formId} is disabled.`);

  const assets = getSegmentAssets(requestRow.segment);

  const jobData = {
    requestRow,
    assets,
    templatePath: formConfig.templatePath,
    globalCss: null
  };

  console.log(
    `[Factory] Processing ${requestRow.id} (${formId}) seg=${requestRow.segment || "default"} engine=${formConfig.engine}`
  );

  if (formConfig.engine === "svg") {
    return await svgGenerate(jobData);
  }

  if (formConfig.engine === "html") {
    jobData.globalCss = loadGlobalCss();
    return await htmlGenerate(jobData);
  }

  throw new Error(`Unknown engine type: ${formConfig.engine}`);
}
