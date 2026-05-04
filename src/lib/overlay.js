export function createRectangleOverlay(canvas, onRectChange) {
  const context = canvas.getContext("2d");
  const state = {
    activePointerId: null,
    dragStart: null,
    draftRect: null,
    enabled: false,
    size: null,
    style: {
      fillColor: "#ffd6cc",
      fillEnabled: false,
      fillOpacity: 0.28,
      fontSize: 18,
      shapeType: "rectangle",
      strokeColor: "#d6412f",
      strokeWidth: 3,
      textColor: "#d6412f",
      textValue: "",
    },
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.enabled || !state.size) {
      return;
    }

    state.activePointerId = event.pointerId;
    state.dragStart = getCanvasPoint(canvas, event);
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.enabled || state.activePointerId !== event.pointerId || !state.dragStart) {
      return;
    }

    const currentPoint = getCanvasPoint(canvas, event);
    state.draftRect = createRectFromPoints(state.dragStart, currentPoint, state.size);
    redraw();
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!state.enabled || state.activePointerId !== event.pointerId) {
      return;
    }

    canvas.releasePointerCapture(event.pointerId);
    state.activePointerId = null;
    state.dragStart = null;

    if (state.draftRect) {
      onRectChange(state.draftRect);
    }
  });

  return {
    clear() {
      state.draftRect = null;
      redraw();
    },
    setEnabled(enabled) {
      state.enabled = enabled;
      canvas.style.pointerEvents = enabled ? "auto" : "none";
      canvas.classList.toggle("is-interactive", enabled);
    },
    resize(size) {
      state.size = size;
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      redraw();
    },
    setRect(rect) {
      state.draftRect = rect;
      redraw();
    },
    setStyle(style) {
      state.style = { ...state.style, ...style };
      redraw();
    },
  };

  function redraw() {
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!state.draftRect) {
      return;
    }

    context.save();
    context.strokeStyle = state.style.strokeColor;
    context.lineWidth = state.style.strokeWidth;
    context.setLineDash([12, 8]);

    if (state.style.fillEnabled) {
      context.globalAlpha = state.style.fillOpacity;
      context.fillStyle = state.style.fillColor;
      fillShape(context, state.style.shapeType, state.draftRect);
      context.globalAlpha = 1;
    }

    drawShapeOutline(context, state.style.shapeType, state.draftRect);

    if (state.style.shapeType === "textbox" && state.style.textValue?.trim()) {
      context.save();
      context.setLineDash([]);
      context.fillStyle = state.style.textColor;
      const previewFontSize = Math.max(
        10,
        Math.min(state.style.fontSize || 18, Math.max(state.draftRect.height - 12, 10)),
      );
      context.font = `bold ${previewFontSize}px "Avenir Next", "Trebuchet MS", sans-serif`;
      context.fillText(
        state.style.textValue.trim().slice(0, 24),
        state.draftRect.x + 10,
        state.draftRect.y + previewFontSize + 8,
        Math.max(state.draftRect.width - 20, 40),
      );
      context.restore();
    }

    context.restore();
  }
}

function drawShapeOutline(context, shapeType, rect) {
  if (shapeType === "ellipse") {
    context.beginPath();
    context.ellipse(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
    return;
  }

  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

function fillShape(context, shapeType, rect) {
  if (shapeType === "ellipse") {
    context.beginPath();
    context.ellipse(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    return;
  }

  context.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function getCanvasPoint(canvas, event) {
  const bounds = canvas.getBoundingClientRect();

  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function createRectFromPoints(start, end, size) {
  const clampedStartX = clamp(start.x, 0, size.width);
  const clampedStartY = clamp(start.y, 0, size.height);
  const clampedEndX = clamp(end.x, 0, size.width);
  const clampedEndY = clamp(end.y, 0, size.height);
  const x = Math.min(clampedStartX, clampedEndX);
  const y = Math.min(clampedStartY, clampedEndY);
  const width = Math.abs(clampedEndX - clampedStartX);
  const height = Math.abs(clampedEndY - clampedStartY);

  return {
    x,
    y,
    width,
    height,
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
