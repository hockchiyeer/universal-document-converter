import express from "express";
import path from "path";
import puppeteer from "puppeteer";
import { ZipArchive } from "archiver";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // We need to handle large HTML payloads
  app.use(express.json({ limit: "50mb" }));

  // API Route to convert to PDF or Image
  app.post("/api/convert", async (req, res) => {
    const { type, payload, format = "pdf" } = req.body;

    if (!type || !payload) {
      return res.status(400).json({ error: "Missing type or payload" });
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
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
        // Convert PDF to images using pdf.js inside a new page
        const imgPage = await browser.newPage();
        
        await imgPage.setContent(`
          <!DOCTYPE html>
          <html>
          <head>
              <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
          </head>
          <body>
          <script>
              pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
              
              window.convertPdfToImages = async function(dataArray) {
                  const bytes = new Uint8Array(dataArray);
                  
                  const doc = await pdfjsLib.getDocument({data: bytes}).promise;
                  const numPages = doc.numPages;
                  const images = [];
                  
                  for (let i = 1; i <= numPages; i++) {
                      const page = await doc.getPage(i);
                      const scale = 2.0; // High quality
                      const viewport = page.getViewport({ scale: scale });
                      
                      const canvas = document.createElement('canvas');
                      const context = canvas.getContext('2d');
                      canvas.width = viewport.width;
                      canvas.height = viewport.height;
                      
                      await page.render({
                          canvasContext: context,
                          viewport: viewport
                      }).promise;
                      
                      const dataUrl = canvas.toDataURL('image/png');
                      images.push(dataUrl.split(',')[1]);
                  }
                  
                  return images;
              }
          </script>
          </body>
          </html>
        `, { waitUntil: "networkidle2", timeout: 90000 });

        const pdfArray = Array.from(new Uint8Array(pdfBuffer));
        const base64Images = await imgPage.evaluate((data: number[]) => {
          return (window as any).convertPdfToImages(data);
        }, pdfArray);

        await browser.close();

        // Create Zip containing images
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=document-images.zip');
        
        const archive = new ZipArchive({
          zlib: { level: 9 } // Sets the compression level.
        });

        archive.on('error', function(err) {
          throw err;
        });

        archive.pipe(res);

        for (let i = 0; i < base64Images.length; i++) {
          const imgBuffer = Buffer.from(base64Images[i], 'base64');
          archive.append(imgBuffer, { name: `page-${i + 1}.png` });
        }

        archive.finalize();

      } else {
        await browser.close();
        
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=document.pdf`);
        res.end(pdfBuffer);
      }
    } catch (err: any) {
      console.error("Conversion Error:", err);
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
