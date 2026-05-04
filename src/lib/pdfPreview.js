import * as pdfjsLib from "../../node_modules/pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PREVIEW_WIDTH = 940;

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).toString();

export async function loadPdfDocument(pdfBytes) {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  return loadingTask.promise;
}

export async function getPagePreviewSize(pdfDocument, pageNumber = 1, zoomScale = 1) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = getScaledViewport(page, zoomScale);

  return {
    width: viewport.width,
    height: viewport.height,
  };
}

export async function startPagePreviewRender(pdfDocument, pageNumber, canvas, zoomScale = 1) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = getScaledViewport(page, zoomScale);
  const context = canvas.getContext("2d");

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const renderTask = page.render({
    canvasContext: context,
    viewport,
  });

  return {
    renderTask,
    width: viewport.width,
    height: viewport.height,
  };
}

function getScaledViewport(page, zoomScale = 1) {
  const unscaledViewport = page.getViewport({ scale: 1 });
  const targetWidth = Math.min(MAX_PREVIEW_WIDTH, unscaledViewport.width) * zoomScale;
  const scale = targetWidth / unscaledViewport.width;

  return page.getViewport({ scale });
}
