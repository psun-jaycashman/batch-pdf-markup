import { denormalizeRect, normalizeRect } from "./coordinateMapping.js";

export function defaultTemplate(overrides = {}) {
  const normalizedPageRule =
    overrides.pageRule === "specific_page" ? "specific_pages" : overrides.pageRule;
  const normalizedPageSelection =
    overrides.pageSelection ??
    (typeof overrides.pageNumber === "number" ? String(overrides.pageNumber) : "1");

  return {
    name: "Roof Review Box",
    type: "rectangle",
    pageRule: normalizedPageRule || "first_page",
    pageSelection: normalizedPageSelection,
    strokeColor: "#d6412f",
    strokeWidth: 3,
    opacity: 1,
    fillColor: "#ffd6cc",
    fillEnabled: false,
    fillOpacity: 0.28,
    fontSize: 18,
    label: "REVIEW",
    textColor: "#d6412f",
    bounds: null,
    ...overrides,
  };
}

export function createTemplateFromDraftRect({ draftRect, previewSize, template }) {
  return {
    ...template,
    bounds: normalizeRect(draftRect, previewSize),
  };
}

export function templateToDraftRect(template, previewSize) {
  if (!template?.bounds || !previewSize) {
    return null;
  }

  return denormalizeRect(template.bounds, previewSize);
}
