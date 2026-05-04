const fs = require("fs/promises");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const SUPPORTED_TEMPLATE_TYPES = new Set(["rectangle", "ellipse", "textbox"]);

async function writeAnnotatedPdf({ sourcePath, destinationPath, template }) {
  validateTemplate(template);

  const sourceBytes = await fs.readFile(sourcePath);
  const pdfDocument = await PDFDocument.load(sourceBytes);
  await applyTemplateToDocument(pdfDocument, template);

  const outputBytes = await pdfDocument.save();
  await fs.writeFile(destinationPath, outputBytes);

  return destinationPath;
}

async function batchApplyTemplate({ inputDirectory, outputDirectory, template }) {
  validateTemplate(template);

  const fileNames = await fs.readdir(inputDirectory);
  const pdfFileNames = fileNames.filter((fileName) => /\.pdf$/i.test(fileName));

  if (pdfFileNames.length === 0) {
    throw new Error("No PDF files were found in the selected input folder.");
  }

  await fs.mkdir(outputDirectory, { recursive: true });

  const outputPaths = [];
  for (const fileName of pdfFileNames) {
    const sourcePath = path.join(inputDirectory, fileName);
    const fileExtension = path.extname(fileName);
    const outputPath = path.join(
      outputDirectory,
      `${path.basename(fileName, fileExtension)}-marked.pdf`,
    );

    await writeAnnotatedPdf({
      sourcePath,
      destinationPath: outputPath,
      template,
    });

    outputPaths.push(outputPath);
  }

  return {
    processedCount: outputPaths.length,
    outputPaths,
  };
}

async function applyTemplateToDocument(pdfDocument, template) {
  const pages = pdfDocument.getPages();
  const targetIndexes = getTargetPageIndexes(template, pages.length);
  const shouldDrawLabel = Boolean(template.label?.trim());
  let font = null;

  if (shouldDrawLabel) {
    font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  }

  for (const pageIndex of targetIndexes) {
    const page = pages[pageIndex];
    drawTemplate(page, template, font);
  }
}

function drawTemplate(page, template, font) {
  const pdfBounds = normalizedBoundsToPdfBounds(page.getSize(), template.bounds);
  const strokeColor = hexToRgbColor(template.strokeColor);
  const fillColor = template.fillEnabled ? hexToRgbColor(template.fillColor) : undefined;
  const textColor = hexToRgbColor(template.textColor || template.strokeColor);

  if (template.type === "ellipse") {
    drawEllipseTemplate(page, template, pdfBounds, strokeColor, fillColor, font, textColor);
    return;
  }

  if (template.type === "textbox") {
    drawTextboxTemplate(page, template, pdfBounds, strokeColor, fillColor, font, textColor);
    return;
  }

  drawRectangleTemplate(page, template, pdfBounds, strokeColor, fillColor, font, textColor);
}

function drawRectangleTemplate(page, template, pdfBounds, strokeColor, fillColor, font, textColor) {
  page.drawRectangle({
    x: pdfBounds.x,
    y: pdfBounds.y,
    width: pdfBounds.width,
    height: pdfBounds.height,
    color: fillColor,
    borderColor: strokeColor,
    borderWidth: template.strokeWidth,
    opacity: template.fillEnabled ? template.fillOpacity : 0,
    borderOpacity: template.opacity,
  });

  if (!font || !template.label?.trim()) {
    return;
  }

  const fontSize = resolveFontSize(template, pdfBounds);

  drawTextInBounds(page, pdfBounds, template.label.trim(), font, fontSize, textColor, template);
}

function drawEllipseTemplate(page, template, pdfBounds, strokeColor, fillColor, font, textColor) {
  page.drawEllipse({
    x: pdfBounds.x + pdfBounds.width / 2,
    y: pdfBounds.y + pdfBounds.height / 2,
    xScale: pdfBounds.width / 2,
    yScale: pdfBounds.height / 2,
    color: fillColor,
    borderColor: strokeColor,
    borderWidth: template.strokeWidth,
    opacity: template.fillEnabled ? template.fillOpacity : 0,
    borderOpacity: template.opacity,
  });

  if (!font || !template.label?.trim()) {
    return;
  }

  const fontSize = resolveFontSize(template, pdfBounds);
  drawTextInBounds(page, pdfBounds, template.label.trim(), font, fontSize, textColor, template);
}

function drawTextboxTemplate(page, template, pdfBounds, strokeColor, fillColor, font, textColor) {
  page.drawRectangle({
    x: pdfBounds.x,
    y: pdfBounds.y,
    width: pdfBounds.width,
    height: pdfBounds.height,
    color: fillColor,
    borderColor: strokeColor,
    borderWidth: template.strokeWidth,
    opacity: template.fillEnabled ? template.fillOpacity : 0,
    borderOpacity: template.opacity,
  });

  if (!font || !template.label?.trim()) {
    return;
  }

  const fontSize = resolveFontSize(template, pdfBounds, 14);
  drawTextInBounds(page, pdfBounds, template.label.trim(), font, fontSize, textColor, template);
}

function drawTextInBounds(page, bounds, value, font, fontSize, textColor, template) {
  page.drawText(value, {
    x: bounds.x + 10,
    y: bounds.y + Math.max(bounds.height - fontSize - 10, 10),
    size: fontSize,
    font,
    color: textColor,
    opacity: template.opacity,
    maxWidth: Math.max(bounds.width - 20, 40),
    lineHeight: Math.max(fontSize * 1.2, fontSize + 2),
  });
}

function resolveFontSize(template, pdfBounds, minimum = 12) {
  if (typeof template.fontSize === "number" && template.fontSize > 0) {
    return template.fontSize;
  }

  return Math.max(minimum, Math.min(pdfBounds.height * 0.4, 28));
}

function normalizedBoundsToPdfBounds(pageSize, bounds) {
  const width = pageSize.width * bounds.width;
  const height = pageSize.height * bounds.height;
  const x = pageSize.width * bounds.x;
  const y = pageSize.height - pageSize.height * (bounds.y + bounds.height);

  return { x, y, width, height };
}

function getTargetPageIndexes(template, pageCount) {
  if (pageCount <= 0) {
    throw new Error("The selected PDF does not contain any pages.");
  }

  if (template.pageRule === "all_pages") {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  if (template.pageRule === "odd_pages") {
    return Array.from({ length: pageCount }, (_, index) => index).filter(
      (index) => (index + 1) % 2 === 1,
    );
  }

  if (template.pageRule === "even_pages") {
    return Array.from({ length: pageCount }, (_, index) => index).filter(
      (index) => (index + 1) % 2 === 0,
    );
  }

  if (template.pageRule === "specific_pages" || template.pageRule === "specific_page") {
    return parseSpecificPageSelection(
      template.pageSelection ?? template.pageNumber,
      pageCount,
    ).map((pageNumber) => pageNumber - 1);
  }

  return [0];
}

function validateTemplate(template) {
  if (!template || !SUPPORTED_TEMPLATE_TYPES.has(template.type)) {
    throw new Error("Template type must be rectangle, ellipse, or textbox.");
  }

  if (!template.bounds) {
    throw new Error("Template bounds are required.");
  }

  const { x, y, width, height } = template.bounds;
  const values = [x, y, width, height];
  const hasInvalidNumber = values.some(
    (value) => typeof value !== "number" || Number.isNaN(value),
  );

  if (hasInvalidNumber) {
    throw new Error("Template bounds must contain numeric values.");
  }

  if (width <= 0 || height <= 0) {
    throw new Error("Template width and height must be greater than zero.");
  }

  if (x < 0 || y < 0 || x + width > 1 || y + height > 1) {
    throw new Error("Template bounds must stay inside the preview area.");
  }

  if (!/^#[0-9a-f]{6}$/i.test(template.strokeColor)) {
    throw new Error("Template stroke color must be a 6-digit hex color.");
  }

  if (!/^#[0-9a-f]{6}$/i.test(template.textColor || "")) {
    throw new Error("Template text color must be a 6-digit hex color.");
  }

  if (template.fillEnabled && !/^#[0-9a-f]{6}$/i.test(template.fillColor || "")) {
    throw new Error("Template fill color must be a 6-digit hex color.");
  }

  if (typeof template.strokeWidth !== "number" || template.strokeWidth <= 0) {
    throw new Error("Template stroke width must be greater than zero.");
  }

  if (typeof template.opacity !== "number" || template.opacity <= 0 || template.opacity > 1) {
    throw new Error("Template opacity must be between 0 and 1.");
  }

  if (
    typeof template.fillOpacity !== "number" ||
    template.fillOpacity < 0 ||
    template.fillOpacity > 1
  ) {
    throw new Error("Template fill opacity must be between 0 and 1.");
  }

  if (typeof template.fontSize !== "number" || template.fontSize <= 0) {
    throw new Error("Template font size must be greater than zero.");
  }

  if (
    (template.pageRule === "specific_pages" || template.pageRule === "specific_page") &&
    (!template.pageSelection || String(template.pageSelection).trim().length === 0) &&
    !template.pageNumber
  ) {
    throw new Error("Specific pages must contain a comma-separated list such as 1, 3, 8, 9.");
  }
}

function hexToRgbColor(hexColor) {
  const normalized = hexColor.replace("#", "");
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;

  return rgb(red, green, blue);
}

function parseSpecificPageSelection(pageSelection, pageCount) {
  const segments = String(pageSelection)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    throw new Error("Specific pages must contain at least one page number.");
  }

  const pageNumbers = [];
  for (const segment of segments) {
    const pageNumber = Number(segment);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`Specific page ${segment} is outside the PDF page range.`);
    }

    if (!pageNumbers.includes(pageNumber)) {
      pageNumbers.push(pageNumber);
    }
  }

  return pageNumbers.sort((left, right) => left - right);
}

module.exports = {
  batchApplyTemplate,
  writeAnnotatedPdf,
};
