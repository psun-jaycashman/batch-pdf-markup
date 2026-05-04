export function normalizeRect(draftRect, previewSize) {
  return {
    x: clamp(draftRect.x / previewSize.width),
    y: clamp(draftRect.y / previewSize.height),
    width: clamp(draftRect.width / previewSize.width),
    height: clamp(draftRect.height / previewSize.height),
  };
}

export function denormalizeRect(bounds, previewSize) {
  if (!bounds) {
    return null;
  }

  return {
    x: bounds.x * previewSize.width,
    y: bounds.y * previewSize.height,
    width: bounds.width * previewSize.width,
    height: bounds.height * previewSize.height,
  };
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}
