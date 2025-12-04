// src/server.js - LAYER 1: Plumber PDF Microservice (Rendering Only)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { renderPdf } from "./pdf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const APP = express();
APP.use(express.json({ limit: "20mb" }));

// CORS - allow CID API to call us
const allowed = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

APP.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowed.length || (origin && allowed.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const TPL_DIR = path.join(__dirname, "..", "templates");

// Health check
APP.get("/healthz", (_req, res) => res.status(200).json({ ok: true, service: "plumber-pdf-backend" }));

// Single PDF endpoint - CID API calls this for each segment
APP.post("/render-pdf", async (req, res) => {
  try {
    const { segment, data } = req.body;
    
    if (!segment) {
      return res.status(400).json({ ok: false, error: "Missing segment name" });
    }

    // Map segment names to template paths
    const TEMPLATE_MAP = {
      PlumberSupp: "PlumberSupp",
      PlumberAccord125: "PlumberAccord125", 
      PlumberAccord126: "PlumberAccord126",
      Contractor_FieldNames: "Contractor_FieldNames",
    };

    const templateName = TEMPLATE_MAP[segment];
    if (!templateName) {
      return res.status(400).json({ ok: false, error: `Unknown segment: ${segment}` });
    }

    const htmlPath = path.join(TPL_DIR, templateName, "index.ejs");
    const cssPath = path.join(TPL_DIR, templateName, "styles.css");

    // Render PDF
    const buffer = await renderPdf({ htmlPath, cssPath, data: data || {} });

    // Return PDF buffer
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${segment}.pdf"`);
    res.send(buffer);

  } catch (err) {
    console.error("PDF render error:", err);
    res.status(500).json({ 
      ok: false, 
      error: "PDF_RENDER_FAILED",
      detail: String(err?.message || err)
    });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
const server = APP.listen(PORT, () => {
  console.log(`Plumber PDF backend listening on ${PORT}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
