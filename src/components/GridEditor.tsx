import React, { useEffect, useRef, useState } from "react";
import type { RGB } from "../types";
import type { GridConfirmResult } from "./GridEditorBase";
import { GridEditor as BaseGridEditor } from "./GridEditorBase";

export type { GridConfirmResult } from "./GridEditorBase";

interface Props {
  image: HTMLImageElement;
  onBack: () => void;
  onConfirm: (result: GridConfirmResult) => void;
}

interface CellRef {
  grid: number;
  col: number;
  row: number;
}

interface PointerStart {
  cell: CellRef;
  circle: SVGCircleElement;
  clientX: number;
  clientY: number;
  dragging: boolean;
}

function rgbToHex(rgb: RGB): string {
  const toHex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function hexToRgb(value: string): RGB {
  const hex = value.replace(/^#/, "");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbDistance(a: RGB, b: RGB): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function sampleImageColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): RGB {
  const radius = 4;
  const size = radius * 2 + 1;
  const sx = Math.min(
    Math.max(0, Math.round(x - radius)),
    Math.max(0, ctx.canvas.width - size),
  );
  const sy = Math.min(
    Math.max(0, Math.round(y - radius)),
    Math.max(0, ctx.canvas.height - size),
  );
  const data = ctx.getImageData(sx, sy, size, size).data;

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }

  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  };
}

export const GridEditor: React.FC<Props> = ({ image, onBack, onConfirm }) => {
  const [selectedCell, setSelectedCell] = useState<CellRef | null>(null);
  const [color, setColor] = useState("#ff0000");
  const [availableColors, setAvailableColors] = useState<RGB[]>([]);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const overridesRef = useRef(new Map<string, string>());
  const pointerStartRef = useRef(new Map<number, PointerStart>());
  const delegatedPointerIdsRef = useRef(new Set<number>());

  useEffect(() => {
    overridesRef.current.clear();
    pointerStartRef.current.clear();
    delegatedPointerIdsRef.current.clear();
    setSelectedCell(null);
    setAvailableColors([]);
    setIsColorPickerOpen(false);
  }, [image]);

  useEffect(() => {
    if (!isColorPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !colorPickerRef.current?.contains(target)) {
        setIsColorPickerOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsColorPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isColorPickerOpen]);

  useEffect(() => {
    const findCell = (circle: SVGCircleElement): CellRef | null => {
      const svg = circle.closest<SVGSVGElement>(".grid-overlay");
      if (!svg) return null;

      const grids = Array.from(
        document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
      );
      const grid = grids.indexOf(svg);
      if (grid < 0) return null;

      const hitCircles = Array.from(
        svg.querySelectorAll<SVGCircleElement>("circle"),
      ).filter((item) => Number(item.getAttribute("r")) === 10);

      const radius = Number(circle.getAttribute("r"));

      if (radius === 10) {
        const index = hitCircles.indexOf(circle);
        if (index < 0) return null;
        const cols = Math.max(1, hitCircles.length / 4);
        return {
          grid,
          col: index % cols,
          row: Math.floor(index / cols),
        };
      }

      if (radius !== 14) return null;

      const handles = Array.from(
        svg.querySelectorAll<SVGCircleElement>("circle"),
      ).filter((item) => Number(item.getAttribute("r")) === 14);
      const index = handles.indexOf(circle);
      if (index < 0) return null;

      if (handles.length === 2) {
        return { grid, col: 0, row: index === 0 ? 0 : 3 };
      }

      const cols = Math.max(1, hitCircles.length / 4);
      const handleCells: CellRef[] = [
        { grid, col: 0, row: 0 },
        { grid, col: cols - 1, row: 0 },
        { grid, col: 0, row: 3 },
        { grid, col: cols - 1, row: 3 },
      ];
      return handleCells[index] ?? null;
    };

    const getCircle = (event: Event): SVGCircleElement | null => {
      for (const target of event.composedPath()) {
        if (target instanceof SVGCircleElement) return target;
      }
      return null;
    };

    const collectAvailableColors = (): RGB[] => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        ".canvas-wrapper canvas",
      );
      const ctx = canvas?.getContext("2d");
      if (!ctx) return [];

      const result: RGB[] = [];
      const circles = Array.from(
        document.querySelectorAll<SVGCircleElement>(
          '.grid-overlay circle[r="4.2"]',
        ),
      );

      for (const circle of circles) {
        const x = Number(circle.getAttribute("cx"));
        const y = Number(circle.getAttribute("cy"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const rgb = sampleImageColor(ctx, x, y);
        if (result.some((existing) => rgbDistance(existing, rgb) <= 36)) {
          continue;
        }
        result.push(rgb);
      }

      return result;
    };

    const openPicker = (cell: CellRef) => {
      const key = `${cell.grid}-${cell.col}-${cell.row}`;
      const current = overridesRef.current.get(key);
      const colors = collectAvailableColors();
      setAvailableColors(colors);
      setColor(current ?? (colors[0] ? rgbToHex(colors[0]) : "#ff0000"));
      setSelectedCell(cell);
    };

    const dispatchDragStart = (start: PointerStart, event: PointerEvent) => {
      delegatedPointerIdsRef.current.add(event.pointerId);
      start.dragging = true;

      const syntheticDown = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: 0,
        buttons: 1,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
      });

      start.circle.dispatchEvent(syntheticDown);
      delegatedPointerIdsRef.current.delete(event.pointerId);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (delegatedPointerIdsRef.current.has(event.pointerId)) return;

      const circle = getCircle(event);
      if (!circle) return;

      const cell = findCell(circle);
      if (!cell) return;

      const radius = Number(circle.getAttribute("r"));

      if (radius === 10) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPicker(cell);
        return;
      }

      if (radius === 14) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pointerStartRef.current.set(event.pointerId, {
          cell,
          circle,
          clientX: event.clientX,
          clientY: event.clientY,
          dragging: false,
        });
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const start = pointerStartRef.current.get(event.pointerId);
      if (!start || start.dragging) return;

      const moved = Math.hypot(
        event.clientX - start.clientX,
        event.clientY - start.clientY,
      );
      if (moved <= 20) return;

      dispatchDragStart(start, event);
    };

    const onPointerUp = (event: PointerEvent) => {
      const start = pointerStartRef.current.get(event.pointerId);
      pointerStartRef.current.delete(event.pointerId);
      if (!start) return;

      if (start.dragging) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openPicker(start.cell);
    };

    const onPointerCancel = (event: PointerEvent) => {
      pointerStartRef.current.delete(event.pointerId);
      delegatedPointerIdsRef.current.delete(event.pointerId);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, []);

  const applyColor = () => {
    if (!selectedCell) return;
    const key = `${selectedCell.grid}-${selectedCell.col}-${selectedCell.row}`;
    overridesRef.current.set(key, color);
    setSelectedCell(null);
  };

  const resetColor = () => {
    if (!selectedCell) return;
    const key = `${selectedCell.grid}-${selectedCell.col}-${selectedCell.row}`;
    overridesRef.current.delete(key);
    setSelectedCell(null);
  };

  const handleConfirm = (result: GridConfirmResult) => {
    if (overridesRef.current.size === 0) {
      onConfirm(result);
      return;
    }

    const tubes = result.tubes.map((tube) => [...tube]);
    const palette = [...result.paletteRgb];
    const grids = Array.from(
      document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
    );
    let tubeOffset = 0;

    grids.forEach((svg, gridIndex) => {
      const hitCircles = Array.from(
        svg.querySelectorAll<SVGCircleElement>("circle"),
      ).filter((item) => Number(item.getAttribute("r")) === 10);
      const cols = Math.max(1, hitCircles.length / 4);

      for (let col = 0; col < cols; col++) {
        const tubeIndex = tubeOffset + col;
        if (!tubes[tubeIndex]) continue;

        for (let row = 0; row < 4; row++) {
          const key = `${gridIndex}-${col}-${row}`;
          const hex = overridesRef.current.get(key);
          if (!hex) continue;

          const rgb = hexToRgb(hex);
          let paletteIndex = palette.findIndex(
            (candidate) => candidate && rgbDistance(candidate, rgb) < 1,
          );
          if (paletteIndex < 0) {
            paletteIndex = palette.length;
            palette.push(rgb);
          }

          const position = 3 - row;
          if (position < tubes[tubeIndex].length) {
            tubes[tubeIndex][position] = paletteIndex;
          } else {
            tubes[tubeIndex].push(paletteIndex);
          }
        }
      }
      tubeOffset += cols;
    });

    onConfirm({ ...result, tubes, paletteRgb: palette });
  };

  const selectedKey = selectedCell
    ? `${selectedCell.grid}-${selectedCell.col}-${selectedCell.row}`
    : "";

  return (
    <div style={{ position: "relative" }}>
      <BaseGridEditor image={image} onBack={onBack} onConfirm={handleConfirm} />
      {selectedCell && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: 20,
            transform: "translateX(-50%)",
            zIndex: 1000,
            padding: 12,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,.2)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: "min(720px, calc(100vw - 32px))",
          }}
        >
          <label id="grid-color-select-label">読み込んだ色から選択</label>
          <div
            ref={colorPickerRef}
            style={{ position: "relative", minWidth: 180 }}
          >
            <button
              id="grid-color-select"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isColorPickerOpen}
              aria-labelledby="grid-color-select-label"
              onClick={() => setIsColorPickerOpen((open) => !open)}
              disabled={availableColors.length === 0}
              style={{
                width: "100%",
                height: 36,
                padding: "4px 32px 4px 8px",
                display: "flex",
                alignItems: "center",
                border: "1px solid #888",
                borderRadius: 6,
                background: "#fff",
                cursor: availableColors.length === 0 ? "default" : "pointer",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  borderRadius: 4,
                  border: "1px solid #888",
                  background: color,
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: 10,
                  top: 14,
                  width: 0,
                  height: 0,
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop: "6px solid #555",
                }}
              />
            </button>

            {isColorPickerOpen && availableColors.length > 0 && (
              <div
                role="listbox"
                aria-label="読み込んだ色"
                style={{
                  position: "absolute",
                  left: 0,
                  top: "calc(100% + 4px)",
                  zIndex: 1001,
                  width: "100%",
                  maxHeight: 220,
                  overflowY: "auto",
                  padding: 6,
                  boxSizing: "border-box",
                  background: "#fff",
                  border: "1px solid #888",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,.2)",
                }}
              >
                {availableColors.map((rgb, index) => {
                  const hex = rgbToHex(rgb);
                  const selected = hex.toLowerCase() === color.toLowerCase();

                  return (
                    <button
                      key={`${hex}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-label="この色を選択"
                      onClick={() => {
                        setColor(hex);
                        setIsColorPickerOpen(false);
                      }}
                      style={{
                        width: "100%",
                        height: 40,
                        padding: 5,
                        margin: 0,
                        display: "flex",
                        alignItems: "center",
                        border: selected
                          ? "2px solid #000"
                          : "2px solid transparent",
                        borderRadius: 4,
                        background: selected ? "#eee" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 30,
                          height: 30,
                          flexShrink: 0,
                          borderRadius: 4,
                          border: "1px solid #888",
                          background: hex,
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {availableColors.length === 0 && (
            <span style={{ color: "#666" }}>
              画像から色を取得できませんでした
            </span>
          )}
          <button onClick={applyColor} disabled={availableColors.length === 0}>
            適用
          </button>
          <button onClick={resetColor}>自動</button>
          <button onClick={() => setSelectedCell(null)}>キャンセル</button>
        </div>
      )}
    </div>
  );
};
