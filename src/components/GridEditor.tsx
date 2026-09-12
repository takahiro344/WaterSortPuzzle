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

  useEffect(() => {
    overridesRef.current.clear();
    setSelectedCell(null);
    setAvailableColors([]);
    setIsColorPickerOpen(false);
  }, [image]);

  // BaseGridEditor owns the actual SVG grid rendering, so reflect color-picker
  // selections onto its visible intersection circles without changing the
  // existing AUTO / EMPTY / UNKNOWN editing behavior.
  useEffect(() => {
    const applyDisplayOverrides = () => {
      const grids = Array.from(
        document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
      );

      for (const [key, hex] of overridesRef.current) {
        const [gridIndex, col, row] = key.split("-").map(Number);
        const svg = grids[gridIndex];
        if (!svg) continue;

        const hitCircles = Array.from(
          svg.querySelectorAll<SVGCircleElement>('circle[r="10"]'),
        );
        const cols = Math.max(1, hitCircles.length / 4);
        const circles = Array.from(
          svg.querySelectorAll<SVGCircleElement>('circle[r="4.2"]'),
        );
        const circle = circles[row * cols + col];
        if (circle && circle.getAttribute("fill") !== hex) {
          circle.setAttribute("fill", hex);
        }
      }
    };

    const observer = new MutationObserver(applyDisplayOverrides);
    const canvasWrapper = document.querySelector(".canvas-wrapper");
    if (canvasWrapper) {
      observer.observe(canvasWrapper, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["cx", "cy", "r", "fill"],
      });
    }

    applyDisplayOverrides();
    return () => observer.disconnect();
  }, []);

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

  const sampleCellColor = (cell: CellRef): RGB | null => {
    const key = `${cell.grid}-${cell.col}-${cell.row}`;
    const override = overridesRef.current.get(key);
    if (override) return hexToRgb(override);

    const grids = Array.from(
      document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
    );
    const svg = grids[cell.grid];
    if (!svg) return null;

    const circles = Array.from(
      svg.querySelectorAll<SVGCircleElement>('circle[r="4.2"]'),
    );
    const hitCircles = Array.from(
      svg.querySelectorAll<SVGCircleElement>('circle[r="10"]'),
    );
    const cols = Math.max(1, hitCircles.length / 4);
    const index = cell.row * cols + cell.col;
    const circle = circles[index];
    if (!circle) return null;

    const x = Number(circle.getAttribute("cx"));
    const y = Number(circle.getAttribute("cy"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const canvas = document.querySelector<HTMLCanvasElement>(
      ".canvas-wrapper canvas",
    );
    const ctx = canvas?.getContext("2d");
    if (!ctx) return null;

    return sampleImageColor(ctx, x, y);
  };

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

      // 同系色を1つの色グループとしてまとめ、各グループの出現数も数える。
      // Water Sort は1色につき4マスなので、4マス以上確認できている色は
      // すでに明確に判定できている色として、色選択肢から除外する。
      const colorGroups: { color: RGB; count: number }[] = [];
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
        const group = colorGroups.find(
          (existing) => rgbDistance(existing.color, rgb) <= 36,
        );
        if (group) {
          group.count++;
        } else {
          colorGroups.push({ color: rgb, count: 1 });
        }
      }

      return colorGroups
        .filter((group) => group.count < 4)
        .map((group) => group.color);
    };

    const openPicker = (cell: CellRef) => {
      const key = `${cell.grid}-${cell.col}-${cell.row}`;
      const current = overridesRef.current.get(key);
      const colors = collectAvailableColors();
      setAvailableColors(colors);
      setColor(current ?? (colors[0] ? rgbToHex(colors[0]) : "#ff0000"));
      setSelectedCell(cell);
    };

    const findCellAtPoint = (
      clientX: number,
      clientY: number,
    ): CellRef | null => {
      const grids = Array.from(
        document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
      );
      let best: { cell: CellRef; distance: number } | null = null;

      grids.forEach((svg, grid) => {
        const hitCircles = Array.from(
          svg.querySelectorAll<SVGCircleElement>('circle[r="10"]'),
        );
        const cols = Math.max(1, hitCircles.length / 4);

        hitCircles.forEach((circle, index) => {
          const rect = circle.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;

          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const distance = Math.hypot(clientX - cx, clientY - cy);

          const hitRadius = Math.max(rect.width, rect.height) / 2 + 4;
          if (distance > hitRadius) return;

          const cell: CellRef = {
            grid,
            col: index % cols,
            row: Math.floor(index / cols),
          };
          if (!best || distance < best.distance) {
            best = { cell, distance };
          }
        });
      });

      return best?.cell ?? null;
    };

    const handlePointerStart = new Map<
      number,
      { x: number; y: number; cell: CellRef; target: SVGElement }
    >();
    const delegatedPointerIds = new Set<number>();

    const onPointerDown = (event: PointerEvent) => {
      if (delegatedPointerIds.has(event.pointerId)) {
        delegatedPointerIds.delete(event.pointerId);
        return;
      }

      const circle = getCircle(event);
      if (circle && Number(circle.getAttribute("r")) === 14) {
        const cell = findCell(circle);
        if (!cell) return;

        handlePointerStart.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          cell,
          target: circle,
        });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const cell = findCellAtPoint(event.clientX, event.clientY);
      if (!cell) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openPicker(cell);
    };

    const onPointerMove = (event: PointerEvent) => {
      const start = handlePointerStart.get(event.pointerId);
      if (!start) return;

      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 20) {
        handlePointerStart.delete(event.pointerId);

        delegatedPointerIds.add(event.pointerId);
        start.target.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            button: event.button,
            buttons: event.buttons,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
          }),
        );

        delegatedPointerIds.add(event.pointerId);
        start.target.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            buttons: event.buttons,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
          }),
        );
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const start = handlePointerStart.get(event.pointerId);
      if (!start) return;

      handlePointerStart.delete(event.pointerId);

      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 20) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPicker(start.cell);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      handlePointerStart.delete(event.pointerId);
      delegatedPointerIds.delete(event.pointerId);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, []);

  const applyColor = () => {
    if (!selectedCell) return;
    const key = `${selectedCell.grid}-${selectedCell.col}-${selectedCell.row}`;
    overridesRef.current.set(key, color);

    const grids = Array.from(
      document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
    );
    const svg = grids[selectedCell.grid];
    if (svg) {
      const hitCircles = Array.from(
        svg.querySelectorAll<SVGCircleElement>('circle[r="10"]'),
      );
      const cols = Math.max(1, hitCircles.length / 4);
      const circles = Array.from(
        svg.querySelectorAll<SVGCircleElement>('circle[r="4.2"]'),
      );
      const circle = circles[selectedCell.row * cols + selectedCell.col];
      circle?.setAttribute("fill", color);
    }

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
          <label id="grid-color-select-label">候補色</label>
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
              画像から選択可能な色を取得できませんでした
            </span>
          )}

          <button
            type="button"
            onClick={applyColor}
            disabled={availableColors.length === 0}
            style={{ whiteSpace: "nowrap" }}
          >
            適用
          </button>
          <button
            type="button"
            onClick={resetColor}
            style={{ whiteSpace: "nowrap" }}
          >
            自動
          </button>
          <button
            type="button"
            onClick={() => setSelectedCell(null)}
            style={{ whiteSpace: "nowrap" }}
          >
            キャンセル
          </button>
        </div>
      )}
    </div>
  );
};
