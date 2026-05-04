# Batch PDF Markup

Electron desktop app for previewing a PDF, defining a reusable annotation template, and exporting that template onto one PDF or a whole folder of PDFs.

## Run

```bash
cd "/Users/psun/Documents/New project/batch-pdf-markup"
npm install
npm start
```

## Windows Packaging

Build a Windows installer `.exe`:

```bash
npm run dist:win
```

Build a portable Windows `.exe`:

```bash
npm run dist:win:portable
```

Artifacts are written to `dist/`.
