const path = require("path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const {
  openPdfFile,
  openTemplateFile,
  saveTemplateFile,
  chooseDirectory,
  chooseAnnotatedPdfPath,
} = require("./services/fileDialogs");
const {
  writeAnnotatedPdf,
  batchApplyTemplate,
} = require("./services/pdfMarkup");

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1180,
    minHeight: 780,
    backgroundColor: "#ebe4d7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, "..", "src", "index.html"));
}

function registerIpcHandlers() {
  ipcMain.handle("pdf:open", async () => openPdfFile(dialog));
  ipcMain.handle("template:open", async () => openTemplateFile(dialog));
  ipcMain.handle("template:save", async (_, template) =>
    saveTemplateFile(dialog, template),
  );
  ipcMain.handle("directory:choose", async () => chooseDirectory(dialog));
  ipcMain.handle("pdf:export", async (_, payload) => {
    const destinationPath = await chooseAnnotatedPdfPath(
      dialog,
      payload.sourcePath,
    );

    if (!destinationPath) {
      return { canceled: true };
    }

    await writeAnnotatedPdf({
      sourcePath: payload.sourcePath,
      destinationPath,
      template: payload.template,
    });

    return { canceled: false, outputPath: destinationPath };
  });
  ipcMain.handle("pdf:batch-export", async (_, payload) =>
    batchApplyTemplate(payload),
  );
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
