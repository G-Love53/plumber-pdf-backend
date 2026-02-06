import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const TPL_ROOT = path.join(ROOT, "CID_HomeBase", "templates");
const OUT = path.join(ROOT, "src", "config", "forms.json");

if (!fs.existsSync(TPL_ROOT)) {
  console.error("FATAL: missing CID_HomeBase/templates at:", TPL_ROOT);
  process.exit(1);
}

const dirs = fs
  .readdirSync(TPL_ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

const keys = dirs
  .filter(n => !n.startsWith("."))
  .map(n => n.toUpperCase())
  .sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));

const forms = {};
for (const k of keys) {
  forms[k] = {
    enabled: true,
    engine: "svg",
    templatePath: `CID_HomeBase/templates/${k}`
  };
}

fs.writeFileSync(OUT, JSON.stringify(forms, null, 2) + "\n");
console.log("OK: wrote", OUT, "keys=", keys.length);
