import React, { useEffect, useMemo, useRef, useState } from "react";
import { clusterColors, inferUnknownColor } from "../colorLogic";
import { AUTO, EMPTY, GridCell, RGB, UNKNOWN } from "../types";

interface Point {
  x: number;
  y: number;
}
interface Corners {
  tl: Point;
  tr: Point;
  bl: Point;
  br: Point;
}
interface GridConfig {
  id: number;
  cols: number;
  corners: Corners;
}
export interface GridConfirmResult {
  tubes: number[][];
  capacity: number;
  paletteRgb: (RGB | null)[];
  warnings: string[];
}
interface Props {
  image: HTMLImageElement;
  onBack: () => void;
  onConfirm: (result: GridConfirmResult) => void;
}

const HANDLE_R = 3.5;
const SAMPLE_RADIUS = 4;
const CAPACITY = 4;
const DRAG_THRESHOLD = 12;
const HANDLE_HIT_R = 14;
const CELL_HIT_R = 10;
type Handle = keyof Corners | "topCenter" | "bottomCenter";

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function bilinear(c: Corners, u: number, v: number): Point {
  return lerp(lerp(c.tl, c.tr, u), lerp(c.bl, c.br, u), v);
}
function sampleColorAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): RGB {
  const size = SAMPLE_RADIUS * 2 + 1;
  const sx = Math.min(
    Math.max(0, Math.round(x - SAMPLE_RADIUS)),
    Math.max(0, ctx.canvas.width - size),
  );
  const sy = Math.min(
    Math.max(0, Math.round(y - SAMPLE_RADIUS)),
    Math.max(0, ctx.canvas.height - size),
  );
  const data = ctx.getImageData(sx, sy, size, size).data;
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}
function initialCorners(w: number, h: number): Corners {
  const gridW = w * 0.5,
    gridH = h * 0.5,
    left = (w - gridW) / 2,
    top = (h - gridH) / 2;
  return {
    tl: { x: left, y: top },
    tr: { x: left + gridW, y: top },
    bl: { x: left, y: top + gridH },
    br: { x: left + gridW, y: top + gridH },
  };
}

export const GridEditor: React.FC<Props> = ({ image, onBack, onConfirm }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [grids, setGrids] = useState<GridConfig[]>([]);
  const [selectedGridId, setSelectedGridId] = useState<number | null>(null);
  const [nextGridId, setNextGridId] = useState(1);
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [emptyTubeCount, setEmptyTubeCount] = useState("0");
  const [dragging, setDragging] = useState<{
    gridId: number;
    corner: Handle;
    startX: number;
    startY: number;
    startCorners: Corners;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewColors, setPreviewColors] = useState<Map<string, RGB>>(
    new Map(),
  );

  useEffect(() => {
    const maxW = Math.min(900, image.naturalWidth * 0.5),
      scale = maxW / image.naturalWidth;
    const w = Math.round(image.naturalWidth * scale),
      h = Math.round(image.naturalHeight * scale);
    setCanvasSize({ w, h });
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, w, h);
    setGrids([{ id: 0, cols: 8, corners: initialCorners(w, h) }]);
    setSelectedGridId(0);
    setNextGridId(1);
    setOverrides(new Map());
    setPreviewColors(new Map());
    setErrorMsg(null);
  }, [image]);

  const gridPoints = useMemo(() => {
    const result = new Map<number, Point[][]>();
    for (const grid of grids) {
      const points: Point[][] = [];
      for (let r = 0; r < CAPACITY; r++) {
        const v = r / (CAPACITY - 1),
          row: Point[] = [];
        for (let c = 0; c < grid.cols; c++)
          row.push(
            bilinear(
              grid.corners,
              grid.cols === 1 ? 0.5 : c / (grid.cols - 1),
              v,
            ),
          );
        points.push(row);
      }
      result.set(grid.id, points);
    }
    return result;
  }, [grids]);

  const cellKey = (gridId: number, col: number, row: number) =>
    `${gridId}-${col}-${row}`;

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const scaleX = rect.width > 0 ? canvasSize.w / rect.width : 1,
        scaleY = rect.height > 0 ? canvasSize.h / rect.height : 1;
      const x = Math.min(
          Math.max((e.clientX - rect.left) * scaleX, 0),
          canvasSize.w,
        ),
        y = Math.min(
          Math.max((e.clientY - rect.top) * scaleY, 0),
          canvasSize.h,
        );
      const dx = x - dragging.startX,
        dy = y - dragging.startY;

      // A small amount of movement is normal when tapping on a phone.
      // Do not resize the grid until the movement clearly exceeds the
      // drag threshold. This keeps a handle tap available for cycling
      // AUTO -> EMPTY -> UNKNOWN -> AUTO.
      if (!dragMovedRef.current) {
        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
        dragMovedRef.current = true;
      }

      const corner = dragging.corner;
      setGrids((prev) =>
        prev.map((grid) => {
          if (grid.id !== dragging.gridId) return grid;
          const nextCorners = { ...dragging.startCorners };
          if (corner === "topCenter" || corner === "bottomCenter") {
            for (const key of ["tl", "tr", "bl", "br"] as (keyof Corners)[])
              nextCorners[key] = {
                ...nextCorners[key],
                x: Math.max(
                  0,
                  Math.min(canvasSize.w, dragging.startCorners[key].x + dx),
                ),
              };
            const vertical =
              corner === "topCenter" ? ["tl", "tr"] : ["bl", "br"];
            for (const key of vertical as (keyof Corners)[])
              nextCorners[key] = {
                ...nextCorners[key],
                y: Math.max(
                  0,
                  Math.min(canvasSize.h, dragging.startCorners[key].y + dy),
                ),
              };
          } else {
            const horizontal =
              corner === "tl" || corner === "bl" ? ["tl", "bl"] : ["tr", "br"];
            const vertical =
              corner === "tl" || corner === "tr" ? ["tl", "tr"] : ["bl", "br"];
            for (const key of horizontal as (keyof Corners)[])
              nextCorners[key] = {
                ...nextCorners[key],
                x: Math.max(
                  0,
                  Math.min(canvasSize.w, dragging.startCorners[key].x + dx),
                ),
              };
            for (const key of vertical as (keyof Corners)[])
              nextCorners[key] = {
                ...nextCorners[key],
                y: Math.max(
                  0,
                  Math.min(canvasSize.h, dragging.startCorners[key].y + dy),
                ),
              };
          }
          return { ...grid, corners: nextCorners };
        }),
      );
    };
    const onUp = () => {
      if (!dragMovedRef.current) {
        const corner = dragging.corner;
        const col =
          corner === "tl" || corner === "bl"
            ? 0
            : corner === "tr" || corner === "br"
              ? (grids.find((g) => g.id === dragging.gridId)?.cols ?? 1) - 1
              : 0;
        const row =
          corner === "tl" || corner === "tr" || corner === "topCenter"
            ? 0
            : CAPACITY - 1;
        cycleOverride(dragging.gridId, col, row);
      }
      dragMovedRef.current = false;
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, canvasSize, grids]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || gridPoints.size === 0) return;
    const map = new Map<string, RGB>();
    for (const grid of grids) {
      const points = gridPoints.get(grid.id);
      if (!points) continue;
      for (let r = 0; r < points.length; r++)
        for (let c = 0; c < points[r].length; c++) {
          const p = points[r][c];
          map.set(cellKey(grid.id, c, r), sampleColorAt(ctx, p.x, p.y));
        }
    }
    setPreviewColors(map);
  }, [gridPoints, grids]);

  const cycleOverride = (gridId: number, col: number, row: number) => {
    setSelectedGridId(gridId);
    setOverrides((prev) => {
      const next = new Map(prev),
        key = cellKey(gridId, col, row),
        cur = next.get(key) ?? AUTO;
      if (cur === AUTO) next.set(key, EMPTY);
      else if (cur === EMPTY) {
        const alreadyUnknown = [...next.entries()].some(
          ([k, v]) => v === UNKNOWN && k !== key,
        );
        if (alreadyUnknown) next.set(key, AUTO);
        else next.set(key, UNKNOWN);
      } else next.delete(key);
      return next;
    });
  };

  const handleAddGrid = () => {
    if (!canvasSize.w || !canvasSize.h) return;
    const selected =
      grids.find((g) => g.id === selectedGridId) ?? grids[grids.length - 1];
    if (!selected) return;
    const id = nextGridId,
      offset = Math.max(20, canvasSize.h * 0.08),
      shiftY = selected.corners.bl.y + offset > canvasSize.h ? -offset : offset;
    const clampY = (y: number) => Math.max(0, Math.min(canvasSize.h, y));
    const shifted = {
      tl: {
        x: selected.corners.tl.x,
        y: clampY(selected.corners.tl.y + shiftY),
      },
      tr: {
        x: selected.corners.tr.x,
        y: clampY(selected.corners.tr.y + shiftY),
      },
      bl: {
        x: selected.corners.bl.x,
        y: clampY(selected.corners.bl.y + shiftY),
      },
      br: {
        x: selected.corners.br.x,
        y: clampY(selected.corners.br.y + shiftY),
      },
    };
    setGrids((prev) => [
      ...prev,
      { id, cols: selected.cols, corners: shifted },
    ]);
    setSelectedGridId(id);
    setNextGridId((v) => v + 1);
  };

  const handleRemoveGrid = () => {
    if (grids.length <= 1 || selectedGridId === null) return;
    const index = grids.findIndex((g) => g.id === selectedGridId);
    if (index < 0) return;
    const removedId = grids[index].id,
      remaining = grids.filter((g) => g.id !== removedId);
    setGrids(remaining);
    setSelectedGridId(remaining[Math.max(0, index - 1)].id);
    setOverrides((prev) => {
      const next = new Map<string, number>();
      for (const [key, value] of prev)
        if (!key.startsWith(`${removedId}-`)) next.set(key, value);
      return next;
    });
  };
  const handleAddColumn = () => {
    if (selectedGridId !== null)
      setGrids((prev) =>
        prev.map((g) =>
          g.id === selectedGridId ? { ...g, cols: g.cols + 1 } : g,
        ),
      );
  };
  const handleRemoveColumn = () => {
    if (selectedGridId !== null)
      setGrids((prev) =>
        prev.map((g) =>
          g.id === selectedGridId ? { ...g, cols: Math.max(1, g.cols - 1) } : g,
        ),
      );
  };
  const handleResetGrid = () => {
    setGrids([
      { id: 0, cols: 8, corners: initialCorners(canvasSize.w, canvasSize.h) },
    ]);
    setSelectedGridId(0);
    setNextGridId(1);
    setOverrides(new Map());
  };

  const handleSolveClick = () => {
    setErrorMsg(null);
    const canvas = canvasRef.current,
      ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !grids.length) return;
    const cells: GridCell[] = [];
    for (const grid of grids) {
      const points = gridPoints.get(grid.id);
      if (!points) continue;
      for (let r = 0; r < CAPACITY; r++)
        for (let c = 0; c < grid.cols; c++) {
          const pt = points[r][c],
            key = cellKey(grid.id, c, r);
          cells.push({
            gridId: grid.id,
            col: c,
            row: r,
            x: pt.x,
            y: pt.y,
            rgb: sampleColorAt(ctx, pt.x, pt.y),
            value: overrides.get(key) ?? AUTO,
          });
        }
    }
    const { palette, assignedCells } = clusterColors(cells),
      flatValues = assignedCells.map((c) => c.value),
      inference = inferUnknownColor(flatValues, CAPACITY);
    const warnings: string[] = [];
    let resolvedValues = assignedCells;
    if (flatValues.includes(UNKNOWN)) {
      if (!inference.ok || inference.inferredColor === null) {
        setErrorMsg(inference.message);
        return;
      }
      warnings.push(inference.message);
      resolvedValues = assignedCells.map((c) =>
        c.value === UNKNOWN
          ? { ...c, value: inference.inferredColor as number }
          : c,
      );
    }
    const valueByCell = new Map<string, number>();
    for (const cell of resolvedValues)
      valueByCell.set(`${cell.gridId}-${cell.col}-${cell.row}`, cell.value);
    const tubes: number[][] = [];
    for (const grid of grids)
      for (let c = 0; c < grid.cols; c++) {
        const tube: number[] = [];
        for (let r = CAPACITY - 1; r >= 0; r--) {
          const value = valueByCell.get(`${grid.id}-${c}-${r}`);
          if (value !== undefined && value !== EMPTY) tube.push(value);
        }
        tubes.push(tube);
      }
    const emptyTubeCountValue = Math.max(0, parseInt(emptyTubeCount, 10) || 0);
    for (let i = 0; i < emptyTubeCountValue; i++) tubes.push([]);
    const paletteRgb: (RGB | null)[] = palette.slice();
    if (
      inference.inferredColor !== null &&
      inference.inferredColor >= palette.length
    ) {
      const unknownCell = cells.find((cell) => cell.value === UNKNOWN);
      paletteRgb[inference.inferredColor] = unknownCell?.rgb ?? null;
    }
    onConfirm({ tubes, capacity: CAPACITY, paletteRgb, warnings });
  };

  const renderHandle = (
    grid: GridConfig,
    handle: Handle,
    p: Point,
    key: string,
  ) => {
    const preview = previewColors.get(key);
    const override = overrides.get(key) ?? AUTO;
    const fill =
      override === EMPTY
        ? "transparent"
        : override === UNKNOWN
          ? "#fff"
          : preview
            ? `rgb(${preview.r}, ${preview.g}, ${preview.b})`
            : "transparent";
    const startDrag = (e: React.PointerEvent<SVGCircleElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Keep the drag associated with the touched handle even when the
      // pointer moves quickly outside the small visible circle.
      e.currentTarget.setPointerCapture(e.pointerId);

      dragMovedRef.current = false;
      setSelectedGridId(grid.id);
      setDragging({
        gridId: grid.id,
        corner: handle,
        startX: p.x,
        startY: p.y,
        startCorners: { ...grid.corners },
      });
    };

    return (
      <g key={handle}>
        {/* Invisible larger hit area for touch devices. */}
        <circle
          cx={p.x}
          cy={p.y}
          r={HANDLE_HIT_R}
          fill="transparent"
          stroke="none"
          style={{ pointerEvents: "all", touchAction: "none" }}
          onPointerDown={startDrag}
        />
        {/* Keep the visible handle at the same size. */}
        <circle
          className="corner-handle"
          cx={p.x}
          cy={p.y}
          r={HANDLE_R}
          fill={fill}
          style={{ pointerEvents: "none" }}
          stroke={override === UNKNOWN ? "#000" : "#fff"}
          strokeWidth={1.5}
        />
      </g>
    );
  };

  return (
    <div className="step-panel">
      <h2>(2/3) グリッドで色取得</h2>
      <ol className="instructions">
        <li>
          各グリッドの交点が試験管の色水の中心に来るように、四隅のハンドルを調整してください。
        </li>
        <li>
          g+ / g- でグリッドを追加・削除し、c+ / c-
          で選択中のグリッドの縦線を追加・削除できます。
        </li>
        <li>
          交点をクリックすると 自動 → 空 → 不明 → 自動
          の順に切り替わります（不明は1箇所まで）。
        </li>
      </ol>
      <div className="grid-controls">
        <span>
          グリッド:
          {selectedGridId === null
            ? "-"
            : grids.findIndex((g) => g.id === selectedGridId) + 1}
        </span>
        <button onClick={handleRemoveGrid} disabled={grids.length <= 1}>
          g-
        </button>
        <button onClick={handleAddGrid}>g+</button>
        <button onClick={handleRemoveColumn} disabled={selectedGridId === null}>
          c-
        </button>
        <button onClick={handleAddColumn} disabled={selectedGridId === null}>
          c+
        </button>
        <button onClick={handleResetGrid}>リセット</button>
        <label>
          空試験管
          <input
            type="number"
            min={0}
            value={emptyTubeCount}
            onChange={(e) => setEmptyTubeCount(e.target.value)}
            onBlur={() =>
              setEmptyTubeCount((value) => {
                const parsed = parseInt(value, 10);
                return parsed >= 0 ? String(parsed) : "0";
              })
            }
          />
        </label>
      </div>
      <div
        ref={wrapperRef}
        className="canvas-wrapper"
        style={{ width: canvasSize.w, height: canvasSize.h }}
      >
        <canvas ref={canvasRef} />
        {grids.map((grid) => {
          const points = gridPoints.get(grid.id);
          if (!points) return null;
          const selected = grid.id === selectedGridId;
          return (
            <React.Fragment key={grid.id}>
              <svg
                className="grid-overlay"
                width={canvasSize.w}
                height={canvasSize.h}
                onPointerDown={() => setSelectedGridId(grid.id)}
              >
                {points.map((row, r) => (
                  <line
                    key={`h-${grid.id}-${r}`}
                    className="grid-line"
                    x1={row[0].x}
                    y1={row[0].y}
                    x2={row[row.length - 1].x}
                    y2={row[row.length - 1].y}
                  />
                ))}
                {points[0]?.map((_, c) => (
                  <line
                    key={`v-${grid.id}-${c}`}
                    className="grid-line"
                    x1={points[0][c].x}
                    y1={points[0][c].y}
                    x2={points[points.length - 1][c].x}
                    y2={points[points.length - 1][c].y}
                  />
                ))}
                {points.map((row, r) =>
                  row.map((p, c) => {
                    const key = cellKey(grid.id, c, r),
                      value = overrides.get(key) ?? AUTO,
                      preview = previewColors.get(key);
                    const fill =
                      value === EMPTY
                        ? "transparent"
                        : value === UNKNOWN
                          ? "#fff"
                          : preview
                            ? `rgb(${preview.r}, ${preview.g}, ${preview.b})`
                            : "transparent";
                    return (
                      <g key={key}>
                        {/* Larger invisible hit area makes cell taps easier on mobile. */}
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={CELL_HIT_R}
                          fill="transparent"
                          stroke="none"
                          style={{ pointerEvents: "all", touchAction: "none" }}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            cycleOverride(grid.id, c, r);
                          }}
                        />
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={3.5}
                          fill={fill}
                          stroke={
                            value === UNKNOWN
                              ? "#000"
                              : selected
                                ? "#fff"
                                : "#888"
                          }
                          strokeWidth={1}
                          style={{ pointerEvents: "none" }}
                        />
                      </g>
                    );
                  }),
                )}
                {selected &&
                  (grid.cols === 1
                    ? (["topCenter", "bottomCenter"] as Handle[]).map(
                        (handle) => {
                          const row = handle === "topCenter" ? 0 : CAPACITY - 1;
                          return renderHandle(
                            grid,
                            handle,
                            bilinear(grid.corners, 0.5, row / (CAPACITY - 1)),
                            cellKey(grid.id, 0, row),
                          );
                        },
                      )
                    : (
                        Object.entries(grid.corners) as [keyof Corners, Point][]
                      ).map(([corner, p]) => {
                        const col =
                          corner === "tl" || corner === "bl"
                            ? 0
                            : grid.cols - 1;
                        const row =
                          corner === "tl" || corner === "tr" ? 0 : CAPACITY - 1;
                        return renderHandle(
                          grid,
                          corner,
                          p,
                          cellKey(grid.id, col, row),
                        );
                      }))}
              </svg>
            </React.Fragment>
          );
        })}
      </div>
      {errorMsg && <div className="error-message">{errorMsg}</div>}
      <div className="step-actions">
        <button onClick={onBack}>戻る</button>
        <button className="primary" onClick={handleSolveClick}>
          解く
        </button>
      </div>
    </div>
  );
};
