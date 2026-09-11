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

const HANDLE_R = 4.2;
const SAMPLE_RADIUS = 4;
const CAPACITY = 4;
const DRAG_THRESHOLD = 20;
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
  const candidates = [
    [0, 0],
    [-5, 0],
    [5, 0],
    [0, -5],
    [0, 5],
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ];
  const size = SAMPLE_RADIUS * 2 + 1;

  const sample = (cx: number, cy: number) => {
    const sx = Math.min(
      Math.max(0, Math.round(cx - SAMPLE_RADIUS)),
      Math.max(0, ctx.canvas.width - size),
    );
    const sy = Math.min(
      Math.max(0, Math.round(cy - SAMPLE_RADIUS)),
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
    const rgb = {
      r: Math.round(r / n),
      g: Math.round(g / n),
      b: Math.round(b / n),
    };
    const max = Math.max(rgb.r, rgb.g, rgb.b);
    const min = Math.min(rgb.r, rgb.g, rgb.b);
    return { rgb, chroma: max - min };
  };

  const samples = candidates.map(([dx, dy]) => sample(x + dx, y + dy));
  const center = samples[0];
  if (center.chroma >= 18) return center.rgb;

  let best = center;
  for (const candidate of samples.slice(1)) {
    if (candidate.chroma > best.chroma) best = candidate;
  }
  return best.rgb;
}
function initialCorners(w: number, h: number): Corners {
  const gridW = w * 0.5,
    gridH = h * 0.5,
    left = (w - gridW) / 2,
    top = h * 0.25;
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
    startClientX: number;
    startClientY: number;
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
      const clientDx = e.clientX - dragging.startClientX,
        clientDy = e.clientY - dragging.startClientY;

      if (!dragMovedRef.current) {
        if (Math.hypot(clientDx, clientDy) <= DRAG_THRESHOLD) return;
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
    if (!ctx) return;

    const tubes: number[][] = [];
    const palette: (RGB | null)[] = [];
    const warnings: string[] = [];
    const seenUnknown = new Set<string>();

    for (const grid of grids) {
      const points = gridPoints.get(grid.id);
      if (!points) continue;
      for (let c = 0; c < grid.cols; c++) {
        const tube: number[] = [];
        for (let r = 0; r < CAPACITY; r++) {
          const key = cellKey(grid.id, c, r);
          const override = overrides.get(key);
          if (override !== undefined) {
            tube.push(override);
            continue;
          }
          const rgb = previewColors.get(key) ?? sampleColorAt(ctx, points[r][c].x, points[r][c].y);
          const cluster = clusterColors([rgb])[0];
          if (!cluster) {
            tube.push(UNKNOWN);
            continue;
          }
          const idx = palette.findIndex((p) => p && cluster && Math.hypot(p.r - cluster.r, p.g - cluster.g, p.b - cluster.b) < 45);
          if (idx >= 0) tube.push(idx);
          else {
            palette.push(cluster);
            tube.push(palette.length - 1);
          }
        }
        tubes.push(tube);
      }
    }

    const emptyCount = Math.max(0, Math.floor(Number(emptyTubeCount) || 0));
    for (let i = 0; i < emptyCount; i++) tubes.push([EMPTY, EMPTY, EMPTY, EMPTY]);

    for (const tube of tubes) {
      const unknownCount = tube.filter((v) => v === UNKNOWN).length;
      if (unknownCount > 0) {
        const key = tube.join(",");
        if (!seenUnknown.has(key)) {
          seenUnknown.add(key);
          warnings.push("判定できない色があります。グリッド位置や色の上書きを確認してください。");
        }
      }
    }

    onConfirm({ tubes, capacity: CAPACITY, paletteRgb: palette, warnings });
  };

  const getClientPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return { x: 0, y: 0 };
    const rect = wrapper.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvasSize.w,
      y: ((e.clientY - rect.top) / rect.height) * canvasSize.h,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasSize.w || !canvasSize.h) return;
    const p = getClientPoint(e);
    let best:
      | { gridId: number; corner: Handle; distance: number }
      | null = null;

    for (const grid of grids) {
      const handles: { corner: Handle; point: Point }[] = [
        { corner: "tl", point: grid.corners.tl },
        { corner: "tr", point: grid.corners.tr },
        { corner: "bl", point: grid.corners.bl },
        { corner: "br", point: grid.corners.br },
        {
          corner: "topCenter",
          point: {
            x: (grid.corners.tl.x + grid.corners.tr.x) / 2,
            y: (grid.corners.tl.y + grid.corners.tr.y) / 2,
          },
        },
        {
          corner: "bottomCenter",
          point: {
            x: (grid.corners.bl.x + grid.corners.br.x) / 2,
            y: (grid.corners.bl.y + grid.corners.br.y) / 2,
          },
        },
      ];
      for (const h of handles) {
        const d = Math.hypot(p.x - h.point.x, p.y - h.point.y);
        if (d <= HANDLE_HIT_R && (!best || d < best.distance))
          best = { gridId: grid.id, corner: h.corner, distance: d };
      }
    }

    if (best) {
      const grid = grids.find((g) => g.id === best!.gridId);
      if (!grid) return;
      setSelectedGridId(grid.id);
      dragMovedRef.current = false;
      setDragging({
        gridId: grid.id,
        corner: best.corner,
        startX: p.x,
        startY: p.y,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCorners: grid.corners,
      });
      return;
    }

    let bestCell: { gridId: number; col: number; row: number; distance: number } | null = null;
    for (const grid of grids) {
      const points = gridPoints.get(grid.id);
      if (!points) continue;
      for (let r = 0; r < points.length; r++)
        for (let c = 0; c < points[r].length; c++) {
          const point = points[r][c];
          const d = Math.hypot(p.x - point.x, p.y - point.y);
          if (d <= CELL_HIT_R && (!bestCell || d < bestCell.distance))
            bestCell = { gridId: grid.id, col: c, row: r, distance: d };
        }
    }
    if (bestCell) {
      setSelectedGridId(bestCell.gridId);
      cycleOverride(bestCell.gridId, bestCell.col, bestCell.row);
    }
  };

  return (
    <div className="space-y-4">
      <div ref={wrapperRef} className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border bg-black/5">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          className="block max-w-full touch-none"
        />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
          preserveAspectRatio="none"
        >
          {grids.map((grid) => {
            const points = gridPoints.get(grid.id) ?? [];
            const selected = grid.id === selectedGridId;
            return (
              <g key={grid.id}>
                {points.map((row, r) =>
                  row.map((p, c) => {
                    const rgb = previewColors.get(cellKey(grid.id, c, r));
                    const override = overrides.get(cellKey(grid.id, c, r));
                    const fill =
                      override === EMPTY
                        ? "#ffffff"
                        : override === UNKNOWN
                          ? "#000000"
                          : rgb
                            ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
                            : "#ffffff";
                    return (
                      <circle
                        key={`${r}-${c}`}
                        cx={p.x}
                        cy={p.y}
                        r={3.5}
                        fill={fill}
                        stroke={selected ? "#2563eb" : "#64748b"}
                        strokeWidth={1}
                        opacity={0.95}
                      />
                    );
                  }),
                )}
                {selected && (
                  <>
                    <line
                      x1={grid.corners.tl.x}
                      y1={grid.corners.tl.y}
                      x2={grid.corners.tr.x}
                      y2={grid.corners.tr.y}
                      stroke="#2563eb"
                      strokeWidth={1}
                    />
                    <line
                      x1={grid.corners.bl.x}
                      y1={grid.corners.bl.y}
                      x2={grid.corners.br.x}
                      y2={grid.corners.br.y}
                      stroke="#2563eb"
                      strokeWidth={1}
                    />
                    {(["tl", "tr", "bl", "br"] as (keyof Corners)[]).map((key) => (
                      <circle
                        key={key}
                        cx={grid.corners[key].x}
                        cy={grid.corners[key].y}
                        r={HANDLE_R}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth={2}
                      />
                    ))}
                    <circle
                      cx={(grid.corners.tl.x + grid.corners.tr.x) / 2}
                      cy={(grid.corners.tl.y + grid.corners.tr.y) / 2}
                      r={HANDLE_R}
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth={2}
                    />
                    <circle
                      cx={(grid.corners.bl.x + grid.corners.br.x) / 2}
                      cy={(grid.corners.bl.y + grid.corners.br.y) / 2}
                      r={HANDLE_R}
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth={2}
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={handleAddGrid} className="rounded border px-3 py-1.5 text-sm">g+</button>
        <button type="button" onClick={handleRemoveGrid} className="rounded border px-3 py-1.5 text-sm">g-</button>
        <button type="button" onClick={handleAddColumn} className="rounded border px-3 py-1.5 text-sm">c+</button>
        <button type="button" onClick={handleRemoveColumn} className="rounded border px-3 py-1.5 text-sm">c-</button>
        <button type="button" onClick={handleResetGrid} className="rounded border px-3 py-1.5 text-sm">Reset</button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <label className="text-sm">
          Empty tubes:
          <input
            value={emptyTubeCount}
            onChange={(e) => setEmptyTubeCount(e.target.value)}
            inputMode="numeric"
            className="ml-2 w-16 rounded border px-2 py-1 text-sm"
          />
        </label>
        <button type="button" onClick={onBack} className="rounded border px-3 py-1.5 text-sm">Back</button>
        <button type="button" onClick={handleSolveClick} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Solve</button>
      </div>

      {errorMsg && <p className="text-center text-sm text-red-600">{errorMsg}</p>}
    </div>
  );
};
