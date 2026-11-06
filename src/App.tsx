import React, { useRef, useState } from "react";
import {
  File,
  FileDown,
  FileText,
  FileType2,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "./lib/utils";
import JSZip from "jszip";

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(downloadUrl);
};

const convertPdfClientSide = async (
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> => {
  const pdfjs = (window as any).pdfjsLib;
  if (!pdfjs) {
    throw new Error("PDF processing engine is still initializing. Please try again in a few seconds.");
  }
  pdfjs.GlobalWorkerOptions.workerSrc = "";

  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({
    data: arrayBuffer,
    disableAutoFetch: true,
    disableStream: true,
  }).promise;

  const numPages = doc.numPages;
  const zip = new JSZip();

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  for (let i = 1; i <= numPages; i++) {
    if (onProgress) {
      onProgress(i, numPages);
    }
    const page = await doc.getPage(i);
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const maxDim = Math.max(unscaledViewport.width, unscaledViewport.height);
    const scale = maxDim > 2500 ? 1.0 : (maxDim > 1400 ? 1.5 : 2.0);
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context!,
      viewport,
    }).promise;

    const dataUrl = canvas.toDataURL("image/png");
    zip.file(`page-${i}.png`, dataUrl.split(",")[1], { base64: true });

    page.cleanup();
    context!.clearRect(0, 0, canvas.width, canvas.height);
  }

  return await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
};

type ConversionType = "url" | "html" | "word" | "pdf";
type ExportFormat = "pdf" | "image";

const fileAcceptByType: Record<Exclude<ConversionType, "url">, string> = {
  html: ".html,.htm,text/html",
  word:
    ".docx,.doc,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

const fileHelpTextByType: Record<Exclude<ConversionType, "url">, string> = {
  html: "HTML files only (.html, .htm)",
  word: "Word Documents only (.docx, .doc)",
  pdf: "PDF files only (.pdf)",
};

const hasExtension = (fileName: string, extensions: string[]) =>
  extensions.some((extension) => fileName.toLowerCase().endsWith(extension));

const getFileValidationError = (
  conversionType: ConversionType,
  file: File,
): string | null => {
  if (conversionType === "html") {
    const isHtml =
      file.type === "text/html" || hasExtension(file.name, [".html", ".htm"]);
    return isHtml ? null : "Please upload a valid HTML file.";
  }

  if (conversionType === "word") {
    const isWord =
      hasExtension(file.name, [".docx", ".doc"]) ||
      file.type.includes("wordprocessingml") ||
      file.type === "application/msword";
    return isWord
      ? null
      : "Please upload a valid Word Document (.docx or .doc).";
  }

  if (conversionType === "pdf") {
    const isPdf = file.type === "application/pdf" || hasExtension(file.name, [".pdf"]);
    return isPdf ? null : "Please upload a valid PDF Document.";
  }

  return null;
};

const isValidHttpUrl = (value: string) => {
  try {
    const parsedUrl = new URL(value.trim());
    return ["http:", "https:"].includes(parsedUrl.protocol) && !!parsedUrl.hostname;
  } catch {
    return false;
  }
};

export default function App() {
  const [conversionType, setConversionType] = useState<ConversionType>("url");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [errorDesc, setErrorDesc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const updateSelectedFile = (file: File) => {
    const validationError = getFileValidationError(conversionType, file);

    if (validationError) {
      setSelectedFile(null);
      setErrorDesc(validationError);
      resetFileInput();
      return;
    }

    setSelectedFile(file);
    setErrorDesc(null);
  };

  const changeConversionType = (nextType: ConversionType) => {
    setConversionType(nextType);
    setErrorDesc(null);
    setSelectedFile(null);
    resetFileInput();

    if (nextType === "pdf") {
      setExportFormat("image");
    } else if (conversionType === "pdf") {
      setExportFormat("pdf");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      updateSelectedFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      updateSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleConvert = async () => {
    const trimmedUrl = url.trim();

    if (conversionType === "url" && !isValidHttpUrl(trimmedUrl)) {
      setErrorDesc("Please enter a valid URL.");
      return;
    }

    if (conversionType !== "url" && !selectedFile) {
      setErrorDesc("Please upload a file first.");
      return;
    }

    if (conversionType !== "url" && selectedFile) {
      const validationError = getFileValidationError(conversionType, selectedFile);
      if (validationError) {
        setErrorDesc(validationError);
        setSelectedFile(null);
        resetFileInput();
        return;
      }
    }

    try {
      setIsConverting(true);
      setErrorDesc(null);

      const formatToSend: ExportFormat = conversionType === "pdf" ? "image" : exportFormat;
      const fileBaseName =
        conversionType === "url"
          ? "webpage"
          : selectedFile?.name.replace(/\.[^/.]+$/, "") || "document";

      // If it's a PDF conversion and the file exceeds 20 MB:
      // In Cloud Run environments, request payloads are capped at 32 MB.
      // A 20MB+ PDF becomes >27MB base64 JSON, triggering 413 (Content Too Large).
      // We convert large PDFs directly client-side with PDF.js and JSZip with zero network upload!
      if (conversionType === "pdf" && selectedFile && selectedFile.size > 20 * 1024 * 1024) {
        const zipBlob = await convertPdfClientSide(selectedFile);
        triggerBlobDownload(zipBlob, `${fileBaseName}-images.zip`);
        return;
      }

      let payload = trimmedUrl;
      let uploadId: string | undefined = undefined;

      if (conversionType === "html") {
        payload = await selectedFile!.text();
      } else if (conversionType === "word" || conversionType === "pdf") {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(selectedFile!);
        });
        payload = dataUrl.split(",")[1];

        // If payload is over 15 MB, upload in 10 MB chunks to easily fit Cloud Run's 32 MB limit
        if (payload.length > 15 * 1024 * 1024) {
          const chunkSize = 10 * 1024 * 1024;
          const totalChunks = Math.ceil(payload.length / chunkSize);
          uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;

          for (let i = 0; i < totalChunks; i++) {
            const chunkData = payload.slice(i * chunkSize, (i + 1) * chunkSize);
            const chunkRes = await fetch("/api/upload/chunk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                uploadId,
                chunkIndex: i,
                totalChunks,
                data: chunkData,
              }),
            });
            if (!chunkRes.ok) {
              throw new Error("Failed to upload file chunk");
            }
          }
          payload = "";
        }
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: conversionType,
          payload,
          uploadId,
          format: formatToSend,
        }),
      });

      if (!response.ok) {
        // If the server proxy returns 413 (Content Too Large) and it's a PDF, fall back seamlessly to client-side conversion
        if (response.status === 413 && conversionType === "pdf" && selectedFile) {
          const zipBlob = await convertPdfClientSide(selectedFile);
          triggerBlobDownload(zipBlob, `${fileBaseName}-images.zip`);
          return;
        }

        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to convert file");
      }

      const blob = await response.blob();
      const downloadFilename =
        formatToSend === "image" ? `${fileBaseName}-images.zip` : `${fileBaseName}.pdf`;
      triggerBlobDownload(blob, downloadFilename);
    } catch (err: any) {
      setErrorDesc(err.message || "An unexpected error occurred.");
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-neutral-200">
      <div className="max-w-4xl mx-auto px-6 py-12 md:py-24">
        <header className="mb-12 text-center">
          <div className="inline-flex items-center justify-center p-3 bg-neutral-900 rounded-2xl mb-6 shadow-sm">
            <FileType2 className="w-8 h-8 text-white" />
          </div>
          <h1
            data-cy="app-heading"
            className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-neutral-900"
          >
            Document Converter
          </h1>
          <p className="text-lg text-neutral-500 max-w-xl mx-auto">
            Convert URLs, HTML files, Word documents, and PDFs into perfectly formatted PDF documents or High-Quality PNG Images.
          </p>
        </header>

        <main className="max-w-xl mx-auto">
          <div className="bg-white rounded-3xl p-2 shadow-[0_0_40px_-15px_rgba(0,0,0,0.1)] border border-neutral-100 mb-8">
            <div className="flex bg-neutral-100/50 p-1 rounded-2xl mb-6 flex-wrap sm:flex-nowrap gap-1">
              <button
                type="button"
                data-cy="conversion-tab-url"
                aria-pressed={conversionType === "url"}
                onClick={() => changeConversionType("url")}
                className={cn(
                  "flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-3 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200",
                  conversionType === "url" 
                    ? "bg-white text-neutral-900 shadow-sm border border-neutral-200/50" 
                    : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50"
                )}
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">From </span>URL
              </button>
              <button
                type="button"
                data-cy="conversion-tab-html"
                aria-pressed={conversionType === "html"}
                onClick={() => changeConversionType("html")}
                className={cn(
                  "flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-3 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200",
                  conversionType === "html" 
                    ? "bg-white text-neutral-900 shadow-sm border border-neutral-200/50" 
                    : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50"
                )}
              >
                <Upload className="w-3.5 h-3.5" />
                HTML
              </button>
              <button
                type="button"
                data-cy="conversion-tab-word"
                aria-pressed={conversionType === "word"}
                onClick={() => changeConversionType("word")}
                className={cn(
                  "flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-3 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200",
                  conversionType === "word" 
                    ? "bg-white text-neutral-900 shadow-sm border border-neutral-200/50" 
                    : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50"
                )}
              >
                <FileText className="w-3.5 h-3.5" />
                Word
              </button>
              <button
                type="button"
                data-cy="conversion-tab-pdf"
                aria-pressed={conversionType === "pdf"}
                onClick={() => changeConversionType("pdf")}
                className={cn(
                  "flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-3 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200",
                  conversionType === "pdf" 
                    ? "bg-white text-neutral-900 shadow-sm border border-neutral-200/50" 
                    : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50"
                )}
              >
                <File className="w-3.5 h-3.5" />
                PDF
              </button>
            </div>

            <div className="px-5 pb-6 pt-2">
              {conversionType === "url" ? (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="url" className="sr-only">Webpage URL</label>
                    <input
                      id="url"
                      data-cy="url-input"
                      type="url"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setErrorDesc(null);
                      }}
                      placeholder="https://example.com/article"
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-4 text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  {!selectedFile ? (
                    <div
                      data-cy="file-drop-zone"
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-neutral-200 bg-neutral-50 rounded-xl p-8 text-center cursor-pointer hover:bg-neutral-100 hover:border-neutral-300 transition-all group"
                    >
                      <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm group-hover:scale-105 transition-transform">
                        <Upload className="w-5 h-5 text-neutral-500" />
                      </div>
                      <p className="text-sm font-medium text-neutral-700 mb-1">
                        Click to upload or drag and drop
                      </p>
                      <p className="text-xs text-neutral-400">
                        {fileHelpTextByType[conversionType]}
                      </p>
                      {conversionType === "word" && (
                        <p className="text-[10px] text-neutral-400 mt-2 max-w-[200px] mx-auto leading-tight">
                          Note: Legacy .doc formats may not retain full formatting compared to modern .docx files.
                        </p>
                      )}
                      <input
                        ref={fileInputRef}
                        data-cy="file-input"
                        type="file"
                        accept={fileAcceptByType[conversionType]}
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </div>
                  ) : (
                    <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-2 bg-white rounded-lg shadow-sm shrink-0">
                          {conversionType === "pdf" ? <File className="w-5 h-5 text-neutral-700" /> : conversionType === "html" ? <FileType2 className="w-5 h-5 text-neutral-700" /> : <FileText className="w-5 h-5 text-neutral-700" />}
                        </div>
                        <div className="min-w-0">
                          <p
                            data-cy="selected-file-name"
                            className="text-sm font-medium text-neutral-900 truncate"
                          >
                            {selectedFile.name}
                          </p>
                          <p data-cy="selected-file-size" className="text-xs text-neutral-500">
                            {(selectedFile.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Remove selected file"
                        data-cy="remove-file"
                        onClick={() => {
                          setSelectedFile(null);
                          resetFileInput();
                        }}
                        className="p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Export Format Options */}
              {conversionType !== "pdf" && (
                <div data-cy="export-format" className="mt-6 flex flex-col gap-2">
                  <label className="text-sm font-medium text-neutral-700">Export Format</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-cy="export-pdf"
                      aria-pressed={exportFormat === "pdf"}
                      onClick={() => setExportFormat("pdf")}
                      className={cn(
                        "flex-1 py-2 px-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-all",
                        exportFormat === "pdf"
                          ? "bg-neutral-900 border-neutral-900 text-white"
                          : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                      )}
                    >
                      <FileDown className="w-4 h-4" />
                      PDF Document
                    </button>
                    <button
                      type="button"
                      data-cy="export-image"
                      aria-pressed={exportFormat === "image"}
                      onClick={() => setExportFormat("image")}
                      className={cn(
                        "flex-1 py-2 px-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-all",
                        exportFormat === "image"
                          ? "bg-neutral-900 border-neutral-900 text-white"
                          : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                      )}
                    >
                      <ImageIcon className="w-4 h-4" />
                      PNG Images (ZIP)
                    </button>
                  </div>
                </div>
              )}

              {errorDesc && (
                <div
                  data-cy="error-message"
                  role="alert"
                  className="mt-4 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100"
                >
                  {errorDesc}
                </div>
              )}

              <button
                type="button"
                data-cy="convert-button"
                onClick={handleConvert}
                disabled={isConverting}
                aria-busy={isConverting}
                className="w-full mt-6 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 text-white font-medium py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:active:scale-100 disabled:cursor-not-allowed shadow-sm"
              >
                {isConverting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Converting...
                  </>
                ) : (
                  <>
                    <FileDown className="w-5 h-5" />
                    Convert
                  </>
                )}
              </button>
            </div>
          </div>
          
          <div className="text-center text-xs text-neutral-400">
            <p>Ensure URLs are publicly accessible to be accurately converted.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
