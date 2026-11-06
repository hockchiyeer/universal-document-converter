import express from "express";
import path from "path";
import puppeteer from "puppeteer";
import { ZipArchive } from "archiver";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase JSON payload limit for large documents (e.g. 30MB+ PDF/Word base64)
  app.use(express.json({ limit: "250mb" }));

  // In-memory store for serving documents internally to Puppeteer with zero serialization overhead
  const tempDocuments = new Map<string, { buffer: Buffer; mime: string; expires: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [id, item] of tempDocuments.entries()) {
      if (item.expires < now) {
        tempDocuments.delete(id);
      }
    }
  }, 60000);

  app.get("/api/internal-doc/:id", (req, res) => {
    const doc = tempDocuments.get(req.params.id);
    if (!doc) {
      return res.status(404).send("Document not found");
    }
    res.setHeader("Content-Type", doc.mime);
    res.setHeader("Content-Length", doc.buffer.length);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(doc.buffer);
  });

  // Serve internal PDF renderer page directly from Express (independent of public/ directory)
  app.get("/pdf-renderer.html", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PDF Renderer</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body style="margin: 0; background: white;">
  <canvas id="pdf-canvas"></canvas>
  <script>
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }

    window.renderPdfStreaming = async function(docUrl) {
      const response = await fetch(docUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch document: ' + response.status + ' ' + response.statusText);
      }
      const arrayBuffer = await response.arrayBuffer();
      const doc = await pdfjsLib.getDocument({
        data: arrayBuffer,
        disableAutoFetch: true,
        disableStream: true
      }).promise;

      const numPages = doc.numPages;
      const canvas = document.getElementById('pdf-canvas');
      const context = canvas.getContext('2d');

      for (let i = 1; i <= numPages; i++) {
        const page = await doc.getPage(i);
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const maxDim = Math.max(unscaledViewport.width, unscaledViewport.height);
        const scale = maxDim > 2500 ? 1.0 : (maxDim > 1400 ? 1.5 : 2.0);
        const viewport = page.getViewport({ scale: scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;

        const dataUrl = canvas.toDataURL('image/png');
        if (window.onPageRendered) {
          await window.onPageRendered(i, numPages, dataUrl.split(',')[1]);
        }

        page.cleanup();
        context.clearRect(0, 0, canvas.width, canvas.height);
      }

      return numPages;
    };
  </script>
</body>
</html>`);
  });

  const uploadChunks = new Map<string, { chunks: string[]; totalChunks: number; expires: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [id, item] of uploadChunks.entries()) {
      if (item.expires < now) {
        uploadChunks.delete(id);
      }
    }
  }, 60000);

  app.post("/api/upload/chunk", (req, res) => {
    const { uploadId, chunkIndex, totalChunks, data } = req.body;
    if (!uploadId || chunkIndex === undefined || !totalChunks || !data) {
      return res.status(400).json({ error: "Invalid chunk parameters" });
    }

    let item = uploadChunks.get(uploadId);
    if (!item) {
      item = { chunks: new Array(totalChunks), totalChunks, expires: Date.now() + 600000 };
      uploadChunks.set(uploadId, item);
    }
    item.chunks[chunkIndex] = data;
    item.expires = Date.now() + 600000;

    res.json({ success: true, chunkIndex });
  });

  // API Route to convert to PDF or Image
  app.post("/api/convert", async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let { type, payload, uploadId, format = "pdf" } = req.body;

    if (uploadId) {
      const item = uploadChunks.get(uploadId);
      if (!item || item.chunks.some((c) => !c)) {
        return res.status(400).json({ error: "Missing or incomplete chunk upload" });
      }
      payload = item.chunks.join("");
      uploadChunks.delete(uploadId);
    }

    if (!type || !payload) {
      return res.status(400).json({ error: "Missing type or payload" });
    }

    let browser;
    let docId: string | null = null;
    try {
      browser = await puppeteer.launch({
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-web-security",
        ],
        headless: true,
      });

      let pdfBuffer: Buffer | null = null;

      if (type === "pdf") {
        pdfBuffer = Buffer.from(payload, "base64");
      } else {
        const page = await browser.newPage();

        // Configure viewport
        await page.setViewport({
          width: 1200,
          height: 800,
          deviceScaleFactor: 2,
        });

        if (type === "url") {
          // payload is a URL
          await page.goto(payload, { waitUntil: "networkidle2", timeout: 90000 });
        } else if (type === "html") {
          // payload is raw HTML
          await page.setContent(payload, {
            waitUntil: "networkidle2",
            timeout: 90000,
          });
        } else if (type === "word") {
          // payload is base64 word file (.docx)
          const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
              <meta charset="utf-8">
              <script src="https://unpkg.com/jszip/dist/jszip.min.js"></script>
              <script src="https://unpkg.com/docx-preview/dist/docx-preview.min.js"></script>
              <style>
                 body { background: white; margin: 0; padding: 0; }
                 #container { width: 100%; margin: 0; padding: 0; }
                 .docx-wrapper { background: #fff !important; padding: 0 !important; }
                 section.docx { 
                     box-shadow: none !important; 
                     margin: 0 auto !important; 
                     page-break-after: always;
                     break-after: page;
                 }
                 section.docx:last-child {
                     page-break-after: auto;
                     break-after: auto;
                 }
              </style>
          </head>
          <body>
              <div id="container"></div>
              <script>
                  async function renderDoc() {
                      try {
                          const base64Data = "${payload}";
                          const binaryString = window.atob(base64Data);
                          const len = binaryString.length;
                          const bytes = new Uint8Array(len);
                          for (let i = 0; i < len; i++) {
                              bytes[i] = binaryString.charCodeAt(i);
                          }
                          
                          await docx.renderAsync(bytes, document.getElementById("container"), null, {
                              inWrapper: true,
                              ignoreWidth: false,
                              ignoreHeight: false,
                              ignoreFonts: false,
                              breakPages: true,
                              useBase64URL: true
                          });
                          
                          const el = document.createElement('div');
                          el.id = 'docx-render-done';
                          document.body.appendChild(el);
                      } catch (e) {
                          console.error(e);
                          const errorEl = document.createElement('div');
                          errorEl.id = 'docx-render-error';
                          errorEl.innerText = e.message;
                          document.body.appendChild(errorEl);
                      }
                  }
                  renderDoc();
              </script>
          </body>
          </html>
          `;
          await page.setContent(htmlContent, {
            waitUntil: "networkidle0",
            timeout: 90000,
          });

          // Wait for rendering to complete or fail
          await page.waitForFunction(
            "document.getElementById('docx-render-done') || document.getElementById('docx-render-error')",
            { timeout: 90000 },
          );

          const errorMessage = await page.evaluate(() => {
            const errEl = document.getElementById("docx-render-error");
            return errEl ? errEl.innerText : null;
          });

          if (errorMessage) {
            throw new Error("Failed to render Word document: " + errorMessage);
          }
        } else {
          await browser.close();
          return res
            .status(400)
            .json({ error: "Invalid type. Must be 'url', 'html', 'word', or 'pdf'" });
        }

        // Emulate print media type for best layout.
        await page.emulateMediaType("screen");

        const pdfOptions: import("puppeteer").PDFOptions = {
          format: "A4",
          printBackground: true,
          margin:
            type === "word"
              ? { top: 0, right: 0, bottom: 0, left: 0 }
              : { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
        };

        pdfBuffer = await page.pdf(pdfOptions);
        await page.close();
      }

      if (format === "image" && pdfBuffer) {
        docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        tempDocuments.set(docId, {
          buffer: pdfBuffer,
          mime: "application/pdf",
          expires: Date.now() + 600000,
        });

        // Convert PDF to images using streaming pipeline inside Chromium
        const imgPage = await browser.newPage();
        imgPage.setDefaultNavigationTimeout(300000);
        imgPage.setDefaultTimeout(300000);

        imgPage.on("console", (msg) => console.log("RENDERER LOG:", msg.text()));
        imgPage.on("pageerror", (err) => console.error("RENDERER ERROR:", err));

        // Prepare zip stream immediately
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", "attachment; filename=document-images.zip");

        const archive = new ZipArchive({
          zlib: { level: 6 }, // Level 6 offers fast compression and low CPU overhead
        });

        archive.on("error", function (err) {
          console.error("Archive streaming error:", err);
          throw err;
        });

        archive.pipe(res);

        // Stream each rendered page directly into the zip archive as soon as it completes
        await imgPage.exposeFunction("onPageRendered", (pageNumber: number, _totalPages: number, base64Png: string) => {
          const imgBuffer = Buffer.from(base64Png, "base64");
          archive.append(imgBuffer, { name: `page-${pageNumber}.png` });
        });

        // Open local renderer page (same origin) to prevent CORS, CSP and serialization limits
        await imgPage.goto(`http://127.0.0.1:${PORT}/pdf-renderer.html`, {
          waitUntil: "networkidle2",
          timeout: 60000,
        });

        const internalUrl = `/api/internal-doc/${docId}`;
        await imgPage.evaluate(async (url: string) => {
          return await (window as any).renderPdfStreaming(url);
        }, internalUrl);

        if (docId) {
          tempDocuments.delete(docId);
          docId = null;
        }

        await browser.close();
        archive.finalize();

      } else {
        await browser.close();
        
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=document.pdf`);
        res.end(pdfBuffer);
      }
    } catch (err: any) {
      console.error("Conversion Error:", err);
      if (docId) {
        tempDocuments.delete(docId);
      }
      if (browser) browser.close().catch(() => {});
      if (!res.headersSent) {
        res
          .status(500)
          .json({
            error: "Failed to generate file",
            details: err?.message || String(err),
          });
      }
    }
  });

  // Vite middleware for development or Static serve for production
  if (process.env.NODE_ENV !== "production") {
    // Dynamic import to avoid esbuild complaining when building the server for production
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // The Vite build and bundled server are both emitted under project-root dist/.
    const clientDistPath = path.join(process.cwd(), "dist");
    app.use(express.static(clientDistPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(clientDistPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
