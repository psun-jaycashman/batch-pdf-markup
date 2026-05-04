const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("batchPdfApp", {
  openPdfFile: () => ipcRenderer.invoke("pdf:open"),
  openTemplateFile: () => ipcRenderer.invoke("template:open"),
  saveTemplateFile: (template) => ipcRenderer.invoke("template:save", template),
  chooseDirectory: () => ipcRenderer.invoke("directory:choose"),
  exportAnnotatedPdf: (payload) => ipcRenderer.invoke("pdf:export", payload),
  batchApplyTemplate: (payload) => ipcRenderer.invoke("pdf:batch-export", payload),
});
