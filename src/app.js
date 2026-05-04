import {
  getPagePreviewSize,
  loadPdfDocument,
  startPagePreviewRender,
} from "./lib/pdfPreview.js";
import { createRectangleOverlay } from "./lib/overlay.js";
import {
  createTemplateFromDraftRect,
  defaultTemplate,
  templateToDraftRect,
} from "./lib/templateState.js";

const MAX_CONCURRENT_PAGE_RENDERS = 2;
const DEFAULT_ZOOM_SCALE = 1;
const MIN_ZOOM_SCALE = 0.5;
const MAX_ZOOM_SCALE = 2.5;
const ZOOM_STEP = 0.1;

const state = {
  activeRenderCount: 0,
  currentPdf: null,
  currentPdfDocument: null,
  pageObserver: null,
  pageViews: [],
  placeholderSize: null,
  previewToken: 0,
  renderQueue: [],
  selectedPageNumber: 1,
  template: defaultTemplate(),
  inputDirectory: null,
  outputDirectory: null,
  totalPages: 0,
  zoomScale: DEFAULT_ZOOM_SCALE,
};

const elements = getElements();

bootstrap();

function bootstrap() {
  bindEvents();
  state.template.strokeColor = normalizeHexColor(state.template.strokeColor);
  syncFormWithTemplate();
  setPageNumberState();
  syncOverlayStyle();
  syncZoomControls();
}

function bindEvents() {
  elements.openPdfButton.addEventListener("click", openPdf);
  elements.exportPdfButton.addEventListener("click", exportCurrentPdf);
  elements.clearTemplateButton.addEventListener("click", clearTemplate);
  elements.saveTemplateButton.addEventListener("click", saveTemplate);
  elements.loadTemplateButton.addEventListener("click", loadTemplate);
  elements.previousPageButton.addEventListener("click", showPreviousPage);
  elements.nextPageButton.addEventListener("click", showNextPage);
  elements.zoomOutButton.addEventListener("click", () => {
    void updateZoomScale(state.zoomScale - ZOOM_STEP);
  });
  elements.zoomInButton.addEventListener("click", () => {
    void updateZoomScale(state.zoomScale + ZOOM_STEP);
  });
  elements.inputFolderButton.addEventListener("click", chooseInputFolder);
  elements.outputFolderButton.addEventListener("click", chooseOutputFolder);
  elements.batchApplyButton.addEventListener("click", batchApplyTemplate);
  elements.viewerPanel.addEventListener("wheel", handleViewerWheel, { passive: false });

  elements.templateNameInput.addEventListener("input", syncTemplateFromForm);
  elements.shapeTypeInput.addEventListener("change", syncTemplateFromForm);
  elements.strokeColorPicker.addEventListener("input", () =>
    syncColorPickerToText(elements.strokeColorPicker, elements.strokeColorInput, "#d6412f"),
  );
  elements.strokeColorInput.addEventListener("input", syncTemplateFromForm);
  elements.strokeWidthInput.addEventListener("input", syncTemplateFromForm);
  elements.labelInput.addEventListener("input", syncTemplateFromForm);
  elements.textColorPicker.addEventListener("input", () =>
    syncColorPickerToText(elements.textColorPicker, elements.textColorInput, "#d6412f"),
  );
  elements.textColorInput.addEventListener("input", syncTemplateFromForm);
  elements.fontSizeInput.addEventListener("input", syncTemplateFromForm);
  elements.fillEnabledInput.addEventListener("change", syncTemplateFromForm);
  elements.fillColorPicker.addEventListener("input", () =>
    syncColorPickerToText(elements.fillColorPicker, elements.fillColorInput, "#ffd6cc"),
  );
  elements.fillColorInput.addEventListener("input", syncTemplateFromForm);
  elements.fillOpacityInput.addEventListener("input", syncTemplateFromForm);
  elements.pageRuleInput.addEventListener("change", () => {
    setPageNumberState();
    syncTemplateFromForm();
  });
  elements.pageNumberInput.addEventListener("input", syncTemplateFromForm);
}

async function openPdf() {
  try {
    const result = await window.batchPdfApp.openPdfFile();
    if (!result) {
      return;
    }

    resetPreviewState();
    state.currentPdf = result;
    state.currentPdfDocument = await loadPdfDocument(result.bytes);
    state.totalPages = state.currentPdfDocument.numPages;
    state.selectedPageNumber = 1;
    state.zoomScale = DEFAULT_ZOOM_SCALE;
    state.placeholderSize = await getPagePreviewSize(
      state.currentPdfDocument,
      1,
      state.zoomScale,
    );
    buildScrollablePreview();
    elements.documentTitle.textContent = result.fileName;
    elements.emptyState.style.display = "none";
    elements.pdfPages.classList.remove("hidden");
    await selectPage(1, { scrollIntoView: false });
    syncZoomControls();
    setStatus("Scroll through the PDF, click a page to activate it, then drag a rectangle.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function exportCurrentPdf() {
  if (!state.currentPdf) {
    setStatus("Open a PDF before exporting.", true);
    return;
  }

  if (!state.template.bounds) {
    setStatus("Draw a rectangle before exporting.", true);
    return;
  }

  try {
    syncTemplateFromForm();
    const result = await window.batchPdfApp.exportAnnotatedPdf({
      sourcePath: state.currentPdf.filePath,
      template: state.template,
    });

    if (result.canceled) {
      return;
    }

    setStatus(`Saved marked PDF to ${result.outputPath}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function clearTemplate() {
  state.template = defaultTemplate({
    name: elements.templateNameInput.value.trim() || "Roof Review Box",
    type: elements.shapeTypeInput.value,
    strokeColor: readColorField(elements.strokeColorInput, elements.strokeColorPicker, "#d6412f"),
    strokeWidth: Number(elements.strokeWidthInput.value) || 3,
    label: elements.labelInput.value.trim(),
    textColor: readColorField(elements.textColorInput, elements.textColorPicker, "#d6412f"),
    fontSize: Number(elements.fontSizeInput.value) || 18,
    fillEnabled: elements.fillEnabledInput.checked,
    fillColor: readColorField(elements.fillColorInput, elements.fillColorPicker, "#ffd6cc"),
    fillOpacity: opacityPercentToUnit(elements.fillOpacityInput.value),
    pageRule: elements.pageRuleInput.value,
    pageSelection: normalizePageSelection(elements.pageNumberInput.value),
  });

  syncFormWithTemplate();
  setStatus("Template cleared. Draw a new rectangle on the preview.");
}

async function saveTemplate() {
  if (!state.template.bounds) {
    setStatus("Draw a rectangle before saving a template.", true);
    return;
  }

  syncTemplateFromForm();

  try {
    const result = await window.batchPdfApp.saveTemplateFile(state.template);
    if (result.canceled) {
      return;
    }

    setStatus(`Saved template to ${result.filePath}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadTemplate() {
  try {
    const result = await window.batchPdfApp.openTemplateFile();
    if (!result) {
      return;
    }

    state.template = defaultTemplate(result.template);
    syncFormWithTemplate();
    refreshRenderedPageOverlays();

    setStatus(`Loaded template from ${result.filePath}`);
  } catch (error) {
    setStatus(`Template load failed: ${error.message}`, true);
  }
}

async function chooseInputFolder() {
  const result = await window.batchPdfApp.chooseDirectory();
  if (!result) {
    return;
  }

  state.inputDirectory = result.directoryPath;
  elements.inputFolderPath.textContent = result.directoryPath;
}

async function chooseOutputFolder() {
  const result = await window.batchPdfApp.chooseDirectory();
  if (!result) {
    return;
  }

  state.outputDirectory = result.directoryPath;
  elements.outputFolderPath.textContent = result.directoryPath;
}

async function batchApplyTemplate() {
  if (!state.template.bounds) {
    setStatus("Draw or load a template before running the batch action.", true);
    return;
  }

  if (!state.inputDirectory || !state.outputDirectory) {
    setStatus("Choose both input and output folders first.", true);
    return;
  }

  syncTemplateFromForm();

  try {
    const result = await window.batchPdfApp.batchApplyTemplate({
      inputDirectory: state.inputDirectory,
      outputDirectory: state.outputDirectory,
      template: state.template,
    });

    setStatus(`Applied template to ${result.processedCount} PDF files.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function showPreviousPage() {
  if (state.selectedPageNumber <= 1) {
    return;
  }

  try {
    await selectPage(state.selectedPageNumber - 1, { scrollIntoView: true });
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function showNextPage() {
  if (state.selectedPageNumber >= state.totalPages) {
    return;
  }

  try {
    await selectPage(state.selectedPageNumber + 1, { scrollIntoView: true });
  } catch (error) {
    setStatus(error.message, true);
  }
}

function handleDraftRectChange(pageNumber, draftRect) {
  const pageView = getPageView(pageNumber);
  if (!draftRect || !pageView?.size) {
    state.template.bounds = null;
    refreshRenderedPageOverlays();
    return;
  }

  syncTemplateFromForm();
  state.selectedPageNumber = pageNumber;
  state.template = createTemplateFromDraftRect({
    draftRect,
    previewSize: pageView.size,
    template: state.template,
  });

  if (state.template.pageRule === "specific_page") {
    state.template.pageRule = "specific_pages";
  }

  if (state.template.pageRule === "specific_pages" && isEmptyPageSelection(state.template.pageSelection)) {
    state.template.pageSelection = String(pageNumber);
    elements.pageNumberInput.value = state.template.pageSelection;
  }

  syncPageNavigation();
  refreshRenderedPageOverlays();
  setStatus("Template rectangle updated. Export the current PDF or save the template.");
}

async function selectPage(pageNumber, { scrollIntoView } = { scrollIntoView: false }) {
  const pageView = getPageView(pageNumber);
  if (!pageView) {
    return;
  }

  state.selectedPageNumber = pageNumber;
  await ensurePageRendered(pageView);
  updatePageSelectionStyles();
  syncPageNavigation();

  if (scrollIntoView) {
    pageView.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }
}

function buildScrollablePreview() {
  disconnectPageObserver();
  state.pageViews = [];

  const fragment = document.createDocumentFragment();
  for (let pageNumber = 1; pageNumber <= state.totalPages; pageNumber += 1) {
    const pageView = createPageView(pageNumber);
    state.pageViews.push(pageView);
    fragment.append(pageView.element);
  }

  elements.pdfPages.replaceChildren(fragment);
  state.pageObserver = createPageObserver();

  for (const pageView of state.pageViews) {
    state.pageObserver.observe(pageView.element);
  }
}

function syncTemplateFromForm() {
  const strokeColor = readColorField(elements.strokeColorInput, elements.strokeColorPicker, "#d6412f");
  const textColor = readColorField(elements.textColorInput, elements.textColorPicker, "#d6412f");
  const fillColor = readColorField(elements.fillColorInput, elements.fillColorPicker, "#ffd6cc");
  const fillOpacity = opacityPercentToUnit(elements.fillOpacityInput.value);

  state.template = {
    ...state.template,
    name: elements.templateNameInput.value.trim() || "Rectangle Template",
    type: elements.shapeTypeInput.value,
    strokeColor,
    strokeWidth: Number(elements.strokeWidthInput.value) || 3,
    label: elements.labelInput.value.trim(),
    textColor,
    fontSize: Number(elements.fontSizeInput.value) || 18,
    fillEnabled: elements.fillEnabledInput.checked,
    fillColor,
    fillOpacity,
    pageRule: elements.pageRuleInput.value,
    pageSelection: normalizePageSelection(elements.pageNumberInput.value),
  };

  syncColorFieldElements(elements.strokeColorInput, elements.strokeColorPicker, strokeColor);
  syncColorFieldElements(elements.textColorInput, elements.textColorPicker, textColor);
  syncColorFieldElements(elements.fillColorInput, elements.fillColorPicker, fillColor);

  syncOverlayStyle();
  refreshRenderedPageOverlays();
}

function syncFormWithTemplate() {
  elements.templateNameInput.value = state.template.name || "Rectangle Template";
  elements.shapeTypeInput.value = state.template.type || "rectangle";
  syncColorFieldElements(
    elements.strokeColorInput,
    elements.strokeColorPicker,
    normalizeHexColor(state.template.strokeColor, "#d6412f"),
  );
  elements.strokeWidthInput.value = String(state.template.strokeWidth || 3);
  elements.labelInput.value = state.template.label || "";
  syncColorFieldElements(
    elements.textColorInput,
    elements.textColorPicker,
    normalizeHexColor(state.template.textColor || state.template.strokeColor, "#d6412f"),
  );
  elements.fontSizeInput.value = String(state.template.fontSize || 18);
  elements.fillEnabledInput.checked = Boolean(state.template.fillEnabled);
  syncColorFieldElements(
    elements.fillColorInput,
    elements.fillColorPicker,
    normalizeHexColor(state.template.fillColor || "#ffd6cc", "#ffd6cc"),
  );
  elements.fillOpacityInput.value = String(unitToOpacityPercent(state.template.fillOpacity));
  elements.pageRuleInput.value =
    state.template.pageRule === "specific_page" ? "specific_pages" : state.template.pageRule || "first_page";
  elements.pageNumberInput.value = state.template.pageSelection || "1";
  setPageNumberState();
  syncOverlayStyle();
  refreshRenderedPageOverlays();
}

function setPageNumberState() {
  elements.pageNumberInput.disabled = elements.pageRuleInput.value !== "specific_pages";
}

function syncPageNavigation() {
  const currentPage = state.totalPages > 0 ? state.selectedPageNumber : 0;

  elements.pageIndicator.textContent = `Page ${currentPage} of ${state.totalPages}`;
  elements.previousPageButton.disabled = state.totalPages === 0 || state.selectedPageNumber <= 1;
  elements.nextPageButton.disabled =
    state.totalPages === 0 || state.selectedPageNumber >= state.totalPages;

  if (elements.pageRuleInput.value === "specific_pages" && isEmptyPageSelection(elements.pageNumberInput.value)) {
    elements.pageNumberInput.value = String(state.selectedPageNumber);
    state.template.pageSelection = elements.pageNumberInput.value;
  }
}

function syncZoomControls() {
  const zoomPercent = Math.round(state.zoomScale * 100);
  const hasDocument = Boolean(state.currentPdfDocument);

  elements.zoomIndicator.textContent = `${zoomPercent}%`;
  elements.zoomOutButton.disabled = !hasDocument || state.zoomScale <= MIN_ZOOM_SCALE;
  elements.zoomInButton.disabled = !hasDocument || state.zoomScale >= MAX_ZOOM_SCALE;
}

function syncOverlayStyle() {
  const strokeColor = readColorField(elements.strokeColorInput, elements.strokeColorPicker, "#d6412f");
  const textColor = readColorField(elements.textColorInput, elements.textColorPicker, "#d6412f");
  const fillColor = readColorField(elements.fillColorInput, elements.fillColorPicker, "#ffd6cc");
  const fillOpacity = opacityPercentToUnit(elements.fillOpacityInput.value);

  syncColorFieldElements(elements.strokeColorInput, elements.strokeColorPicker, strokeColor);
  syncColorFieldElements(elements.textColorInput, elements.textColorPicker, textColor);
  syncColorFieldElements(elements.fillColorInput, elements.fillColorPicker, fillColor);
  elements.fillOpacityValue.textContent = `${Math.round(fillOpacity * 100)}%`;
  refreshRenderedPageOverlays();
}

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.style.color = isError ? "#9e2519" : "";
}

function getElements() {
  return {
    batchApplyButton: document.getElementById("batch-apply-button"),
    clearTemplateButton: document.getElementById("clear-template-button"),
    documentTitle: document.getElementById("document-title"),
    emptyState: document.getElementById("empty-state"),
    exportPdfButton: document.getElementById("export-pdf-button"),
    fillColorInput: document.getElementById("fill-color-input"),
    fillColorPicker: document.getElementById("fill-color-picker"),
    fillEnabledInput: document.getElementById("fill-enabled-input"),
    fillOpacityInput: document.getElementById("fill-opacity-input"),
    fillOpacityValue: document.getElementById("fill-opacity-value"),
    fontSizeInput: document.getElementById("font-size-input"),
    inputFolderButton: document.getElementById("input-folder-button"),
    inputFolderPath: document.getElementById("input-folder-path"),
    labelInput: document.getElementById("label-input"),
    loadTemplateButton: document.getElementById("load-template-button"),
    openPdfButton: document.getElementById("open-pdf-button"),
    outputFolderButton: document.getElementById("output-folder-button"),
    outputFolderPath: document.getElementById("output-folder-path"),
    nextPageButton: document.getElementById("next-page-button"),
    pageIndicator: document.getElementById("page-indicator"),
    pageNumberInput: document.getElementById("page-number-input"),
    pageRuleInput: document.getElementById("page-rule-input"),
    pdfPages: document.getElementById("pdf-pages"),
    previousPageButton: document.getElementById("previous-page-button"),
    saveTemplateButton: document.getElementById("save-template-button"),
    shapeTypeInput: document.getElementById("shape-type-input"),
    statusMessage: document.getElementById("status-message"),
    strokeColorPicker: document.getElementById("stroke-color-picker"),
    strokeColorInput: document.getElementById("stroke-color-input"),
    strokeWidthInput: document.getElementById("stroke-width-input"),
    templateNameInput: document.getElementById("template-name-input"),
    textColorPicker: document.getElementById("text-color-picker"),
    textColorInput: document.getElementById("text-color-input"),
    viewerPanel: document.querySelector(".viewer-panel"),
    zoomInButton: document.getElementById("zoom-in-button"),
    zoomIndicator: document.getElementById("zoom-indicator"),
    zoomOutButton: document.getElementById("zoom-out-button"),
  };
}

function normalizeHexColor(value, fallback = "#d6412f") {
  const trimmed = String(value || "").trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;

  if (/^#[0-9a-f]{6}$/i.test(withHash)) {
    return withHash.toLowerCase();
  }

  return fallback;
}

function readColorField(textInput, pickerInput, fallback) {
  const normalizedPickerValue = normalizeHexColor(pickerInput.value, fallback);
  const normalizedTextValue = normalizeHexColor(textInput.value, normalizedPickerValue);

  if (String(textInput.value || "").trim().length > 0) {
    return normalizedTextValue;
  }

  return normalizedPickerValue;
}

function syncColorFieldElements(textInput, pickerInput, value) {
  textInput.value = value;
  pickerInput.value = value;
}

function syncColorPickerToText(pickerInput, textInput, fallback) {
  textInput.value = normalizeHexColor(pickerInput.value, fallback);
  syncTemplateFromForm();
}

function handleViewerWheel(event) {
  if (!state.currentPdfDocument) {
    return;
  }

  if (!event.ctrlKey && !event.metaKey) {
    return;
  }

  event.preventDefault();
  const zoomDelta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
  void updateZoomScale(state.zoomScale + zoomDelta);
}

function opacityPercentToUnit(value) {
  const numericValue = Number(value);

  if (Number.isNaN(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numericValue / 100));
}

function unitToOpacityPercent(value) {
  const numericValue = Number(value);

  if (Number.isNaN(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue * 100)));
}

function clampZoomScale(value) {
  return Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, Math.round(value * 100) / 100));
}

function normalizePageSelection(value) {
  return String(value || "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(", ");
}

function isEmptyPageSelection(value) {
  return normalizePageSelection(value).length === 0;
}

function createPageView(pageNumber) {
  const element = document.createElement("article");
  element.className = "pdf-page";
  element.dataset.pageNumber = String(pageNumber);

  const header = document.createElement("div");
  header.className = "pdf-page-header";

  const label = document.createElement("div");
  label.className = "pdf-page-label";
  label.textContent = `Page ${pageNumber}`;

  const tag = document.createElement("div");
  tag.className = "pdf-page-tag";
  tag.textContent = "Click to edit";

  header.append(label, tag);

  const frame = document.createElement("div");
  frame.className = "pdf-page-frame";
  setPageFrameSize(frame, state.placeholderSize);

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-page-canvas";
  canvas.hidden = true;

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.className = "pdf-page-overlay";
  overlayCanvas.hidden = true;

  const loading = document.createElement("div");
  loading.className = "pdf-page-loading";
  loading.textContent = `Page ${pageNumber}`;

  frame.append(canvas, overlayCanvas, loading);
  element.append(header, frame);

  const overlay = createRectangleOverlay(overlayCanvas, (draftRect) =>
    handleDraftRectChange(pageNumber, draftRect),
  );
  overlay.setEnabled(false);

  element.addEventListener("click", () => {
    void selectPage(pageNumber, { scrollIntoView: false });
  });

  return {
    canvas,
    element,
    frame,
    loading,
    overlay,
    overlayCanvas,
    pageNumber,
    rendered: false,
    renderTask: null,
    renderPromise: null,
    size: state.placeholderSize,
    tag,
    visible: false,
  };
}

function createPageObserver() {
  return new IntersectionObserver(handlePageVisibility, {
    root: elements.viewerPanel,
    rootMargin: "900px 0px 900px 0px",
    threshold: 0,
  });
}

function handlePageVisibility(entries) {
  for (const entry of entries) {
    const pageNumber = Number(entry.target.dataset.pageNumber);
    const pageView = getPageView(pageNumber);
    if (!pageView) {
      continue;
    }

    pageView.visible = entry.isIntersecting;

    if (entry.isIntersecting) {
      void ensurePageRendered(pageView);
      continue;
    }

    unrenderPageView(pageView);
  }
}

async function ensurePageRendered(pageView) {
  if (!state.currentPdfDocument || !pageView) {
    return;
  }

  if (pageView.rendered) {
    updatePageOverlay(pageView);
    return;
  }

  if (pageView.renderPromise) {
    await pageView.renderPromise;
    return;
  }

  pageView.loading.hidden = false;
  pageView.loading.textContent = `Loading page ${pageView.pageNumber}...`;
  pageView.renderPromise = enqueuePageRender(pageView);

  try {
    await pageView.renderPromise;
  } catch (error) {
    pageView.loading.hidden = false;
    pageView.loading.textContent = `Page ${pageView.pageNumber} failed to render`;
    throw error;
  } finally {
    pageView.renderPromise = null;
  }

  if (!pageView.visible && pageView.pageNumber !== state.selectedPageNumber) {
    unrenderPageView(pageView);
  }
}

function enqueuePageRender(pageView) {
  return new Promise((resolve, reject) => {
    state.renderQueue.push({
      pageView,
      previewToken: state.previewToken,
      reject,
      resolve,
    });
    pumpRenderQueue();
  });
}

function pumpRenderQueue() {
  while (
    state.activeRenderCount < MAX_CONCURRENT_PAGE_RENDERS &&
    state.renderQueue.length > 0
  ) {
    const renderTask = state.renderQueue.shift();
    if (!renderTask) {
      return;
    }

    if (renderTask.previewToken !== state.previewToken) {
      renderTask.resolve();
      continue;
    }

    state.activeRenderCount += 1;
    void renderPageTask(renderTask).finally(() => {
      state.activeRenderCount = Math.max(0, state.activeRenderCount - 1);
      pumpRenderQueue();
    });
  }
}

async function renderPageTask(renderTask) {
  const { pageView, previewToken, reject, resolve } = renderTask;

  try {
    const renderResult = await startPagePreviewRender(
      state.currentPdfDocument,
      pageView.pageNumber,
      pageView.canvas,
      state.zoomScale,
    );
    const size = {
      width: renderResult.width,
      height: renderResult.height,
    };

    if (previewToken !== state.previewToken) {
      renderResult.renderTask.cancel();
      resolve();
      return;
    }

    pageView.size = size;
    pageView.renderTask = renderResult.renderTask;
    pageView.rendered = true;
    setPageFrameSize(pageView.frame, size);
    pageView.canvas.hidden = false;
    pageView.overlayCanvas.hidden = false;
    pageView.frame.classList.add("page-has-preview");
    pageView.overlay.resize(size);

    await waitForInitialPaint();

    if (previewToken !== state.previewToken) {
      pageView.renderTask.cancel();
      resolve();
      return;
    }

    pageView.loading.hidden = true;
    updatePageOverlay(pageView);

    pageView.renderTask.promise
      .catch((error) => {
        if (error?.name === "RenderingCancelledException") {
          return;
        }

        if (previewToken !== state.previewToken) {
          return;
        }

        pageView.loading.hidden = false;
        pageView.loading.textContent = `Page ${pageView.pageNumber} failed to finish rendering`;
      })
      .finally(() => {
        if (pageView.renderTask === renderResult.renderTask) {
          pageView.renderTask = null;
        }
      });

    resolve();
  } catch (error) {
    reject(error);
  }
}

function unrenderPageView(pageView) {
  if (!pageView.rendered || pageView.visible || pageView.pageNumber === state.selectedPageNumber) {
    return;
  }

  pageView.renderTask?.cancel();
  pageView.renderTask = null;
  pageView.overlay.clear();
  pageView.canvas.hidden = true;
  pageView.overlayCanvas.hidden = true;
  pageView.frame.classList.remove("page-has-preview");
  resetCanvasElement(pageView.canvas);
  resetCanvasElement(pageView.overlayCanvas);
  pageView.rendered = false;
  pageView.loading.hidden = false;
  pageView.loading.textContent = `Page ${pageView.pageNumber}`;
  setPageFrameSize(pageView.frame, pageView.size || state.placeholderSize);
}

function updatePageSelectionStyles() {
  for (const pageView of state.pageViews) {
    const isSelected = pageView.pageNumber === state.selectedPageNumber;
    pageView.element.classList.toggle("active-page", isSelected);
    pageView.tag.textContent = isSelected ? "Active page" : "Click to edit";
    updatePageOverlay(pageView);
  }
}

function updatePageOverlay(pageView) {
  if (!pageView.rendered || !pageView.size) {
    return;
  }

  pageView.overlay.setEnabled(pageView.pageNumber === state.selectedPageNumber);
  pageView.overlay.setStyle({
    fillColor: normalizeHexColor(elements.fillColorInput.value),
    fillEnabled: elements.fillEnabledInput.checked,
    fillOpacity: opacityPercentToUnit(elements.fillOpacityInput.value),
    fontSize: Number(elements.fontSizeInput.value) || 18,
    shapeType: elements.shapeTypeInput.value,
    strokeColor: normalizeHexColor(elements.strokeColorInput.value),
    strokeWidth: Number(elements.strokeWidthInput.value) || 3,
    textColor: normalizeHexColor(elements.textColorInput.value),
    textValue: elements.labelInput.value.trim(),
  });

  const rect = shouldShowTemplateOnPage(pageView.pageNumber)
    ? templateToDraftRect(state.template, pageView.size)
    : null;

  pageView.overlay.setRect(rect);
}

function refreshRenderedPageOverlays() {
  for (const pageView of state.pageViews) {
    updatePageOverlay(pageView);
  }
}

function shouldShowTemplateOnPage(pageNumber) {
  if (!state.template.bounds) {
    return false;
  }

  if (state.template.pageRule === "all_pages") {
    return true;
  }

  if (state.template.pageRule === "odd_pages") {
    return pageNumber % 2 === 1;
  }

  if (state.template.pageRule === "even_pages") {
    return pageNumber % 2 === 0;
  }

  if (state.template.pageRule === "specific_pages" || state.template.pageRule === "specific_page") {
    return parseSpecificPageSelection(state.template.pageSelection).includes(pageNumber);
  }

  return pageNumber === 1;
}

function getPageView(pageNumber) {
  return state.pageViews[pageNumber - 1] || null;
}

function setPageFrameSize(frame, size) {
  if (!size) {
    return;
  }

  frame.style.width = `${Math.round(size.width)}px`;
  frame.style.height = `${Math.round(size.height)}px`;
}

function resetCanvasElement(canvas) {
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = "0px";
  canvas.style.height = "0px";
}

function resetPreviewState() {
  disconnectPageObserver();
  state.previewToken += 1;
  state.activeRenderCount = 0;
  state.currentPdf = null;
  state.pageViews = [];
  state.placeholderSize = null;
  state.renderQueue = [];
  state.selectedPageNumber = 1;
  state.totalPages = 0;
  state.currentPdfDocument = null;
  state.zoomScale = DEFAULT_ZOOM_SCALE;
  elements.pdfPages.replaceChildren();
  elements.pdfPages.classList.add("hidden");
  elements.emptyState.style.display = "";
  syncPageNavigation();
  syncZoomControls();
}

function disconnectPageObserver() {
  if (!state.pageObserver) {
    return;
  }

  state.pageObserver.disconnect();
  state.pageObserver = null;
}

function waitForInitialPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

async function updateZoomScale(nextZoomScale) {
  const clampedZoomScale = clampZoomScale(nextZoomScale);
  if (clampedZoomScale === state.zoomScale) {
    return;
  }

  state.zoomScale = clampedZoomScale;
  syncZoomControls();

  if (!state.currentPdfDocument) {
    return;
  }

  const previousScrollRange = Math.max(
    elements.viewerPanel.scrollHeight - elements.viewerPanel.clientHeight,
    1,
  );
  const scrollRatio = elements.viewerPanel.scrollTop / previousScrollRange;

  state.previewToken += 1;
  state.activeRenderCount = 0;
  state.renderQueue = [];
  state.placeholderSize = await getPagePreviewSize(
    state.currentPdfDocument,
    1,
    state.zoomScale,
  );

  for (const pageView of state.pageViews) {
    pageView.renderTask?.cancel();
    pageView.renderTask = null;
    pageView.renderPromise = null;
    pageView.overlay.clear();
    pageView.canvas.hidden = true;
    pageView.overlayCanvas.hidden = true;
    pageView.frame.classList.remove("page-has-preview");
    pageView.rendered = false;
    pageView.size = state.placeholderSize;
    pageView.loading.hidden = false;
    pageView.loading.textContent = `Page ${pageView.pageNumber}`;
    resetCanvasElement(pageView.canvas);
    resetCanvasElement(pageView.overlayCanvas);
    setPageFrameSize(pageView.frame, state.placeholderSize);
  }

  await waitForInitialPaint();

  const nextScrollRange = Math.max(
    elements.viewerPanel.scrollHeight - elements.viewerPanel.clientHeight,
    0,
  );
  elements.viewerPanel.scrollTop = nextScrollRange * scrollRatio;

  const selectedPageView = getPageView(state.selectedPageNumber);
  if (selectedPageView) {
    await ensurePageRendered(selectedPageView);
  }

  renderVisiblePages();
}

function renderVisiblePages() {
  if (!state.currentPdfDocument) {
    return;
  }

  const viewerBounds = elements.viewerPanel.getBoundingClientRect();
  const expandedTop = viewerBounds.top - 900;
  const expandedBottom = viewerBounds.bottom + 900;

  for (const pageView of state.pageViews) {
    const pageBounds = pageView.element.getBoundingClientRect();
    const isVisible = pageBounds.bottom >= expandedTop && pageBounds.top <= expandedBottom;

    pageView.visible = isVisible;
    if (isVisible) {
      void ensurePageRendered(pageView);
      continue;
    }

    unrenderPageView(pageView);
  }
}

function parseSpecificPageSelection(pageSelection) {
  return normalizePageSelection(pageSelection)
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => Number(segment))
    .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0);
}
