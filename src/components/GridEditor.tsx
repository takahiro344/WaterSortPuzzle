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
}

interface PointerStart {
  cell: CellRef;
  clientX: number;
  clientY: number;
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

export const GridEditor: React.FC<Props> = ({ image, onBack, onConfirm }) => {
  const [selectedCell, setSelectedCell] = useState<CellRef | null>(null);
  const [color, setColor] = useState("#ff0000");
  const overridesRef = useRef(new Map<string, string>());
  const pointerStartRef = useRef(new Map<number, PointerStart>());
  const syntheticReleaseRef = useRef(false);

  useEffect(() => {
    overridesRef.current.clear();
    pointerStartRef.current.clear();
    setSelectedCell(null);
  }, [image]);

  useEffect(() => {
    const findCell = (target: EventTarget | null): CellRef | null => {
      const circle = target instanceof SVGCircleElement ? target : null;
      if (!circle) return null;

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

      if (Number(circle.getAttribute("r")) === 10) {
        const index = hitCircles.indexOf(circle);
        if (index < 0) return null;

        const cols = Math.max(1, hitCircles.length / 4);
        return {
          grid,
          col: index % cols,
          row: Math.floor(index / cols),
        };
      }

      if (!circle.classList.contains("corner-handle")) return null;

      const handles = Array.from(
        svg.querySelectorAll<SVGCircleElement>("circle.corner-handle"),
      );
      const index = handles.indexOf(circle);
      if (index < 0) return null;

      // GridEditorBase のハンドル描画順:
      // cols=1 は topCenter / bottomCenter、通常は tl / tr / bl / br。
      const handleCount = handles.length;
      if (handleCount === 2) {
        return { grid, col: 0, row: index === 0 ? 0 : 3 };
      }
      const handleCells: CellRef[] = [
        { grid, col: 0, row: 0 },
        { grid, col: hitCircles.length / 4 - 1, row: 0 },
        { grid, col: 0, row: 3 },
        { grid, col: hitCircles.length / 4 - 1, row: 3 },
      ];
      return handleCells[index] ?? null;
    };

    const getCircle = (event: Event): SVGCircleElement | null => {
      for (const target of event.composedPath()) {
        if (target instanceof SVGCircleElement) return target;
      }
      return null;
    };

    const openPicker = (cell: CellRef) => {
      const key = `${cell.grid}-${cell.col}-${cell.row}`;
      setColor(overridesRef.current.get(key) ?? "#ff0000");
      setSelectedCell(cell);
    };

    const onPointerDown = (event: PointerEvent) => {
      const circle = getCircle(event);
      if (!circle) return;

      const cell = findCell(circle);
      if (!cell) return;

      const radius = Number(circle.getAttribute("r"));
      if (radius === 10) {
        // 通常の交点はここで BaseGridEditor の状態切り替えを止める。
        event.preventDefault();
        event.stopImmediatePropagation();
        openPicker(cell);
        return;
      }

      if (circle.classList.contains("corner-handle")) {
        // ハンドルはドラッグを BaseGridEditor に任せる。
        // pointerup 時に移動量を確認し、タップだけ色選択UIに切り替える。
        pointerStartRef.current.set(event.pointerId, {
          cell,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (syntheticReleaseRef.current) return;

      const start = pointerStartRef.current.get(event.pointerId);
      pointerStartRef.current.delete(event.pointerId);
      if (!start) return;

      const moved = Math.hypot(
        event.clientX - start.clientX,
        event.clientY - start.clientY,
      );
      if (moved > 20) return;

      // BaseGridEditor は window の pointerup で、ハンドルのタップを
      // 「自動→空→不明」に切り替える処理として扱っている。
      // タップ時だけ、その処理を実行させずにドラッグ状態を正常終了させる。
      event.preventDefault();
      event.stopImmediatePropagation();

      syntheticReleaseRef.current = true;
      try {
        const base = {
          bubbles: true,
          cancelable: true,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          isPrimary: event.isPrimary,
          buttons: 0,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
        };

        // BaseGridEditor の dragMovedRef を true にしてから元位置へ戻す。
        // これにより、実際のグリッド位置は変えずに cycleOverride だけを回避する。
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            ...base,
            buttons: 1,
            clientX: event.clientX + 21,
            screenX: event.screenX + 21,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            ...base,
            buttons: 1,
            clientX: event.clientX,
            screenX: event.screenX,
          }),
        );
        window.dispatchEvent(new PointerEvent("pointerup", base));
      } finally {
        syntheticReleaseRef.current = false;
      }

      openPicker(start.cell);
    };

    const onPointerCancel = (event: PointerEvent) => {
      pointerStartRef.current.delete(event.pointerId);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
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
