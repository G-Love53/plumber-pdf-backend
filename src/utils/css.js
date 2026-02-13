import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadGlobalCss() {
  try {
    const repoRoot = path.join(__dirname, "../..");
    const cssPath = path.join(repoRoot, "CID_HomeBase", "templates", "_shared", "styles.css");
    return fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
  } catch (err) {
    console.error("Error loading global CSS:", err);
    return "";
  }
}
