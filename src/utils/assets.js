import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadAssetBase64 = (fullPath) => {
  try {
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase();
      const base64 = fs.readFileSync(fullPath).toString("base64");
      if (ext === ".svg") return `data:image/svg+xml;base64,${base64}`;
      if (ext === ".png") return `data:image/png;base64,${base64}`;
    }
    return null;
  } catch (err) {
    console.warn(`Asset load warning: ${fullPath} - ${err.message}`);
    return null;
  }
};

export function getSegmentAssets(segment) {
  const targetSegment = segment ? segment.toLowerCase().trim() : "default";
  const assetsRoot = path.join(__dirname, "../../templates/assets/segments");

  const resolveAsset = (filename) => {
    const specificPath = path.join(assetsRoot, targetSegment, filename);
    const defaultPath = path.join(assetsRoot, "default", filename);
    return loadAssetBase64(specificPath) || loadAssetBase64(defaultPath);
  };

  return {
    logo: resolveAsset("logo.png") || resolveAsset("logo.svg"),
    signature: resolveAsset("signature.svg")
  };
}
