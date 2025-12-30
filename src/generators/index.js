// src/generators/index.js
const forms = require("../config/forms.json");
const { getSegmentAssets } = require("../utils/assets");
const { loadGlobalCss } = require("../utils/css");

const svgEngine = require("./svg-engine");
const htmlEngine = require("./html-engine");

async function generateDocument(requestRow) {
  const formId = requestRow.form_id || "acord25_v1";
  const formConfig = forms[formId];

  if (!formConfig) throw new Error(`Configuration missing for form_id: ${formId}`);
  if (formConfig.enabled === false) throw new Error(`Form ${formId} is disabled.`);

  const assets = getSegmentAssets(requestRow.segment);

  const jobData = {
    requestRow,
    assets,
    templatePath: formConfig.templatePath,
    globalCss: null,
  };

  console.log(
    `[Factory] Processing ${requestRow.id} (${formId}) seg=${requestRow.segment || "default"} engine=${formConfig.engine}`
  );

  if (formConfig.engine === "svg") return svgEngine.generate(jobData);

  if (formConfig.engine === "html") {
    jobData.globalCss = loadGlobalCss();
    return htmlEngine.generate(jobData);
  }

  throw new Error(`Unknown engine type: ${formConfig.engine}`);
}

module.exports = { generateDocument };

