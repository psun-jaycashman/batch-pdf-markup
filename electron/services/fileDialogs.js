const fs = require("fs/promises");
const path = require("path");

async function openPdfFile(dialog) {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "PDF files", extensions: ["pdf"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const fileBytes = await fs.readFile(filePath);

  return {
    fileName: path.basename(filePath),
    filePath,
    bytes: new Uint8Array(fileBytes),
  };
}

async function openTemplateFile(dialog) {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "JSON files", extensions: ["json"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, "utf8");

  return {
    filePath,
    template: JSON.parse(content),
  };
}

async function saveTemplateFile(dialog, template) {
  const fileStem = sanitizeFileName(template?.name || "rectangle-template") || "rectangle-template";
  const defaultName = `${fileStem}.json`;
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: "JSON files", extensions: ["json"] }],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fs.writeFile(result.filePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");

  return {
    canceled: false,
    filePath: result.filePath,
  };
}

async function chooseDirectory(dialog) {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return {
    directoryPath: result.filePaths[0],
  };
}

async function chooseAnnotatedPdfPath(dialog, sourcePath) {
  const sourceDirectory = path.dirname(sourcePath);
  const sourceBaseName = path.basename(sourcePath, path.extname(sourcePath));

  const result = await dialog.showSaveDialog({
    defaultPath: path.join(sourceDirectory, `${sourceBaseName}-marked.pdf`),
    filters: [{ name: "PDF files", extensions: ["pdf"] }],
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  return result.filePath;
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
}

module.exports = {
  chooseAnnotatedPdfPath,
  chooseDirectory,
  openPdfFile,
  openTemplateFile,
  saveTemplateFile,
};
