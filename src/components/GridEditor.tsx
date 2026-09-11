import React, { useEffect, useRef, useState } from "react";
import { GridEditor as BaseGridEditor } from "./GridEditorBase";
import type { GridConfirmResult } from "./GridEditorBase";
import type { RGB } from "../types";

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
  hex: string;
}

function hexToRgb(hex: string): RGB {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbDistance(a: RGB, b: RGB): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function rgbToHex(rgb: RGB): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

export const GridEditor: React.FC<Props> = ({ image, onBack, onConfirm }) => {
  const [selectedCell, setSelectedCell] = useState<CellRef | null>(null);
  const [color, setColor] = useState("#ff0000");
  const overridesRef = useRef(new Map<string, string>());

  useEffect(() => {
    overridesRef.current.clear();
    setSelectedCell(null);
  }, [image]);

  useEffect(() => {
    const getCells = () =>
      Array.from(document.querySelectorAll<SVGSVGElement>(".grid-overlay"));

    const findCell = (target: EventTarget | null): CellRef | null => {
      const circle = target instanceof SVGCircleElement ? target : null;
      if (!circle || Number(circle.getAttribute("r")) !== 10) return null;
      const svg = circle.closest<SVGSVGElement>(".grid-overlay");
      if (!svg) return null;
      const grid = getCells().indexOf(svg);
      if (grid < 0) return null;
      const hitCircles = Array.from(
        svg.querySelectorAll<SVGCircleElement>("circle"),
      ).filter((item) => Number(item.getAttribute("r")) === 10);
      const index = hitCircles.indexOf(circle);
      if (index < 0) return null;
      const cols = Math.max(1, hitCircles.length / 4);
      const col = index % cols;
      const row = Math.floor(index / cols);
      const key = `${grid}-${col}-${row}`;
      return {
        grid,
        col,
        row,
        hex: overridesRef.current.get(key) ?? "#ff0000",
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      const cell = findCell(event.target);
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      const key = `${cell.grid}-${cell.col}-${cell.row}`;
      setColor(overridesRef.current.get(key) ?? "#ff0000");
      setSelectedCell(cell);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const applyColor = () => {
    if (!selectedCell) return;
    const key = `${selectedCell.grid}-${selectedCell.col}-${selectedCell.row}`;
    overridesRef.current.set(key, color);
    const svg = document.querySelectorAll<SVGSVGElement>(".grid-overlay")[
      selectedCell.grid
    ];
    const hitCircles = svg
      ? Array.from(svg.querySelectorAll<SVGCircleElement>("circle")).filter(
          (item) => Number(item.getAttribute("r")) === 10,
        )
      : [];
    const circle = hitCircles[selectedCell.row * (hitCircles.length / 4) + selectedCell.col];
    const visible = circle?.parentElement?.querySelector<SVGCircleElement>(
      `circle[r="4.2"]`,
    );
    if (visible) {
      visible.setAttribute("fill", color);
      visible.setAttribute("stroke", "#fff");
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
    const grids = Array.from(document.querySelectorAll<SVGSVGElement>(".grid-overlay"));
    let tubeOffset = 0;

    grids.forEach((svg, gridIndex) => {
      const hitCircles = Array.from(svg.querySelectorAll<SVGCircleElement>("circle")).filter(
        (item) => Number(item.getAttribute("r")) === 10,
      );
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
  const selectedOverride = selectedKey
    ? overridesRef.current.get(selectedKey)
    : undefined;

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
          }}
        >
          <span>色を選択</span>
          <input
            type="color"
            value={selectedOverride ?? color}
            onChange={(e) => setColor(e.target.value)}
            autoFocus
          />
          <button onClick={applyColor}>適用</button>
          <button onClick={resetColor}>自動</button>
          <button onClick={() => setSelectedCell(null)}>キャンセル</button>
        </div>
      )}
    </div>
  );
};
