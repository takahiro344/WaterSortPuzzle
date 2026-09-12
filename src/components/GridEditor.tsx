import React, { useEffect, useMemo, useRef, useState } from "react";
import { clusterColors } from "../colorLogic";
import { AUTO, EMPTY, GridCell, RGB, UNKNOWN } from "../types";

interface Point { x: number; y: number; }
interface Corners { tl: Point; tr: Point; bl: Point; br: Point; }
interface GridConfig { id: number; cols: number; corners: Corners; }
export interface GridConfirmResult { tubes: number[][]; capacity: number; paletteRgb: (RGB | null)[]; warnings: string[]; }
interface Props { image: HTMLImageElement; onBack: () => void; onConfirm: (result: GridConfirmResult) => void; }

type ColorOverride = number | RGB;
type Handle = keyof Corners | "topCenter" | "bottomCenter";

const GRID_HEIGHT = 100;
const GRID_TOP = 180;
const INITIAL_GRID_COLS = 6;
const HANDLE_R = 4.2;
const SAMPLE_RADIUS = 4;
const CAPACITY = 4;
const DRAG_THRESHOLD = 20;
const HANDLE_HIT_R = 14;
const CELL_HIT_R = 10;
const COLOR_DISTANCE = 45;

function lerp(a: Point, b: Point, t: number): Point { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function bilinear(c: Corners, u: number, v: number): Point { return lerp(lerp(c.tl, c.tr, u), lerp(c.bl, c.br, u), v); }
function colorDistance(a: RGB, b: RGB): number { return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b); }
function sampleColorAt(ctx: CanvasRenderingContext2D, x: number, y: number): RGB {
  const candidates = [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5], [-4, -4], [4, -4], [-4, 4], [4, 4]];
  const size = SAMPLE_RADIUS * 2 + 1;
  const sample = (cx: number, cy: number) => {
    const sx = Math.min(Math.max(0, Math.round(cx - SAMPLE_RADIUS)), Math.max(0, ctx.canvas.width - size));
    const sy = Math.min(Math.max(0, Math.round(cy - SAMPLE_RADIUS)), Math.max(0, ctx.canvas.height - size));
    const data = ctx.getImageData(sx, sy, size, size).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    const rgb = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
    const max = Math.max(rgb.r, rgb.g, rgb.b), min = Math.min(rgb.r, rgb.g, rgb.b);
    return { rgb, chroma: max - min };
  };
  const samples = candidates.map(([dx, dy]) => sample(x + dx, y + dy));
  const center = samples[0];
  if (center.chroma >= 18) return center.rgb;
  let best = center;
  for (const candidate of samples.slice(1)) if (candidate.chroma > best.chroma) best = candidate;
  return best.rgb;
}
function initialCorners(w: number, h: number): Corners {
  const gridW = w * 0.5, gridH = GRID_HEIGHT, left = (w - gridW) / 2, top = GRID_TOP;
  return { tl: { x: left, y: top }, tr: { x: left + gridW, y: top }, bl: { x: left, y: top + gridH }, br: { x: left + gridW, y: top + gridH } };
}

export const GridEditor: React.FC<Props> = ({ image, onBack, onConfirm }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [grids, setGrids] = useState<GridConfig[]>([]);
  const [selectedGridId, setSelectedGridId] = useState<number | null>(null);
  const [nextGridId, setNextGridId] = useState(1);
  const [overrides, setOverrides] = useState<Map<string, ColorOverride>>(new Map());
  const [emptyTubeCount, setEmptyTubeCount] = useState("0");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewColors, setPreviewColors] = useState<Map<string, RGB>>(new Map());
  const [colorPicker, setColorPicker] = useState<{ gridId: number; col: number; row: number } | null>(null);
  const [colorSource, setColorSource] = useState<RGB | null>(null);
  const [colorSourceLabel, setColorSourceLabel] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ gridId: number; corner: Handle; startX: number; startY: number; startClientX: number; startClientY: number; startCorners: Corners; } | null>(null);

  useEffect(() => {
    const maxW = Math.min(900, image.naturalWidth * 0.5), scale = maxW / image.naturalWidth;
    const w = Math.round(image.naturalWidth * scale), h = Math.round(image.naturalHeight * scale);
    setCanvasSize({ w, h });
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.drawImage(image, 0, 0, w, h);
    setGrids([{ id: 0, cols: INITIAL_GRID_COLS, corners: initialCorners(w, h) }]);
    setSelectedGridId(0); setNextGridId(1);
    setOverrides(new Map()); setPreviewColors(new Map()); setColorPicker(null); setColorSource(null); setColorSourceLabel(null); setErrorMsg(null);
  }, [image]);

  const gridPoints = useMemo(() => {
    const result = new Map<number, Point[][]>();
    for (const grid of grids) {
      const points: Point[][] = [];
      for (let r = 0; r < CAPACITY; r++) {
        const v = r / (CAPACITY - 1), row: Point[] = [];
        for (let c = 0; c < grid.cols; c++) row.push(bilinear(grid.corners, grid.cols === 1 ? 0.5 : c / (grid.cols - 1), v));
        points.push(row);
      }
      result.set(grid.id, points);
    }
    return result;
  }, [grids]);

  const cellKey = (gridId: number, col: number, row: number) => `${gridId}-${col}-${row}`;
  const detectedColors = useMemo(() => {
    const palette: RGB[] = [];
    for (const rgb of previewColors.values()) {
      const brightness = (rgb.r + rgb.g + rgb.b) / 3;
      if (brightness <= 40) continue;
      if (palette.findIndex((p) => colorDistance(p, rgb) < COLOR_DISTANCE) < 0) palette.push(rgb);
    }
    return palette;
  }, [previewColors]);

  // Opening the picker on an intersection must not change the active grid.
  // The active grid is used for grid editing (move/resize/c+/c-), while the
  // clicked intersection is the color override destination.
  const openColorPicker = (gridId: number, col: number, row: number) => setColorPicker({ gridId, col, row });

  const setColorOverride = (value: ColorOverride | "auto") => {
    if (!colorPicker) return;
    const key = cellKey(colorPicker.gridId, colorPicker.col, colorPicker.row);
    setOverrides((prev) => {
      const next = new Map(prev);
      if (value === "auto") next.delete(key); else next.set(key, value);
      return next;
    });
    setColorPicker(null);
  };

  const pickColorFromIntersection = (gridId: number, col: number, row: number) => {
    const key = cellKey(gridId, col, row);
    const override = overrides.get(key);
    const rgb = override && typeof override === "object" ? override : previewColors.get(key);
    if (!rgb) return;
    setColorSource(rgb);
    setColorSourceLabel(`グリッド${gridId + 1} / ${col + 1}列 / ${row + 1}段`);
    setColorPicker(null);
  };

  const applyColorSource = () => {
    if (!colorPicker || !colorSource) return;
    const key = cellKey(colorPicker.gridId, colorPicker.col, colorPicker.row);
    setOverrides((prev) => {
      const next = new Map(prev); next.set(key, colorSource); return next;
    });
    setColorPicker(null);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const wrapper = wrapperRef.current; if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const scaleX = rect.width > 0 ? canvasSize.w / rect.width : 1, scaleY = rect.height > 0 ? canvasSize.h / rect.height : 1;
      const x = Math.min(Math.max((e.clientX - rect.left) * scaleX, 0), canvasSize.w), y = Math.min(Math.max((e.clientY - rect.top) * scaleY, 0), canvasSize.h);
      const dx = x - dragging.startX, dy = y - dragging.startY;
      const clientDx = e.clientX - dragging.startClientX, clientDy = e.clientY - dragging.startClientY;
      if (!dragMovedRef.current) { if (Math.hypot(clientDx, clientDy) <= DRAG_THRESHOLD) return; dragMovedRef.current = true; }
      const corner = dragging.corner;
      setGrids((prev) => prev.map((grid) => {
        if (grid.id !== dragging.gridId) return grid;
        const nextCorners = { ...dragging.startCorners };
        if (corner === "topCenter" || corner === "bottomCenter") {
          for (const key of ["tl", "tr", "bl", "br"] as (keyof Corners)[]) nextCorners[key] = { ...nextCorners[key], x: Math.max(0, Math.min(canvasSize.w, dragging.startCorners[key].x + dx)) };
          const vertical = corner === "topCenter" ? ["tl", "tr"] : ["bl", "br"];
          for (const key of vertical as (keyof Corners)[]) nextCorners[key] = { ...nextCorners[key], y: Math.max(0, Math.min(canvasSize.h, dragging.startCorners[key].y + dy)) };
        } else {
          const horizontal = corner === "tl" || corner === "bl" ? ["tl", "bl"] : ["tr", "br"], vertical = corner === "tl" || corner === "tr" ? ["tl", "tr"] : ["bl", "br"];
          for (const key of horizontal as (keyof Corners)[]) nextCorners[key] = { ...nextCorners[key], x: Math.max(0, Math.min(canvasSize.w, dragging.startCorners[key].x + dx)) };
          for (const key of vertical as (keyof Corners)[]) nextCorners[key] = { ...nextCorners[key], y: Math.max(0, Math.min(canvasSize.h, dragging.startCorners[key].y + dy)) };
        }
        return { ...grid, corners: nextCorners };
      }));
    };
    const onUp = () => {
      if (!dragMovedRef.current) {
        const corner = dragging.corner, grid = grids.find((g) => g.id === dragging.gridId);
        const col = corner === "tl" || corner === "bl" ? 0 : corner === "tr" || corner === "br" ? (grid?.cols ?? 1) - 1 : 0;
        const row = corner === "tl" || corner === "tr" || corner === "topCenter" ? 0 : CAPACITY - 1;
        openColorPicker(dragging.gridId, col, row);
      }
      dragMovedRef.current = false; setDragging(null);
    };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [dragging, canvasSize, grids]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d"); if (!ctx || gridPoints.size === 0) return;
    const map = new Map<string, RGB>();
    for (const grid of grids) {
      const points = gridPoints.get(grid.id); if (!points) continue;
      for (let r = 0; r < points.length; r++) for (let c = 0; c < points[r].length; c++) { const p = points[r][c]; map.set(cellKey(grid.id, c, r), sampleColorAt(ctx, p.x, p.y)); }
    }
    setPreviewColors(map);
  }, [gridPoints, grids]);

  const handleAddGrid = () => {
    if (!canvasSize.w || !canvasSize.h) return;
    const selected = grids.find((g) => g.id === selectedGridId) ?? grids[grids.length - 1]; if (!selected) return;
    const id = nextGridId, offset = Math.max(20, canvasSize.h * 0.08), shiftY = selected.corners.bl.y + offset > canvasSize.h ? -offset : offset;
    const clampY = (y: number) => Math.max(0, Math.min(canvasSize.h, y));
    const shifted = { tl: { x: selected.corners.tl.x, y: clampY(selected.corners.tl.y + shiftY) }, tr: { x: selected.corners.tr.x, y: clampY(selected.corners.tr.y + shiftY) }, bl: { x: selected.corners.bl.x, y: clampY(selected.corners.bl.y + shiftY) }, br: { x: selected.corners.br.x, y: clampY(selected.corners.br.y + shiftY) } };
    setGrids((prev) => [...prev, { id, cols: selected.cols, corners: shifted }]); setSelectedGridId(id); setNextGridId((v) => v + 1);
  };
  const handleRemoveGrid = () => {
    if (grids.length <= 1 || selectedGridId === null) return;
    const index = grids.findIndex((g) => g.id === selectedGridId); if (index < 0) return;
    const removedId = grids[index].id, remaining = grids.filter((g) => g.id !== removedId);
    setGrids(remaining); setSelectedGridId(remaining[Math.max(0, index - 1)].id);
    setOverrides((prev) => { const next = new Map<string, ColorOverride>(); for (const [key, value] of prev) if (!key.startsWith(`${removedId}-`)) next.set(key, value); return next; });
  };
  const handleAddColumn = () => { if (selectedGridId !== null) setGrids((prev) => prev.map((g) => g.id === selectedGridId ? { ...g, cols: g.cols + 1 } : g)); };
  const handleRemoveColumn = () => { if (selectedGridId !== null) setGrids((prev) => prev.map((g) => g.id === selectedGridId ? { ...g, cols: Math.max(1, g.cols - 1) } : g)); };
  const handleResetGrid = () => { setGrids([{ id: 0, cols: INITIAL_GRID_COLS, corners: initialCorners(canvasSize.w, canvasSize.h) }]); setSelectedGridId(0); setNextGridId(1); setOverrides(new Map()); setColorPicker(null); setColorSource(null); setColorSourceLabel(null); };

  const handleSolveClick = () => {
    setErrorMsg(null);
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d"); if (!ctx) return;
    const tubes: number[][] = [], palette: (RGB | null)[] = [], warnings: string[] = [];
    const getPaletteIndex = (rgb: RGB) => { const idx = palette.findIndex((p) => p && colorDistance(p, rgb) < COLOR_DISTANCE); if (idx >= 0) return idx; palette.push(rgb); return palette.length - 1; };
    for (const grid of grids) {
      const points = gridPoints.get(grid.id); if (!points) continue;
      for (let c = 0; c < grid.cols; c++) {
        const tube: number[] = [];
        for (let r = 0; r < CAPACITY; r++) {
          const key = cellKey(grid.id, c, r), override = overrides.get(key);
          if (override === EMPTY || override === UNKNOWN) { tube.push(override); continue; }
          const rgb = override && typeof override === "object" ? override : previewColors.get(key) ?? sampleColorAt(ctx, points[r][c].x, points[r][c].y);
          const cluster = clusterColors([{ gridId: grid.id, col: c, row: r, rgb, value: AUTO } as GridCell]).assignedCells[0]?.value;
          if (cluster === undefined || cluster === EMPTY || cluster === UNKNOWN) { tube.push(UNKNOWN); continue; }
          tube.push(getPaletteIndex(rgb));
        }
        tubes.push(tube);
      }
    }
    const emptyCount = Math.max(0, Math.floor(Number(emptyTubeCount) || 0));
    for (let i = 0; i < emptyCount; i++) tubes.push([EMPTY, EMPTY, EMPTY, EMPTY]);
    if (tubes.some((tube) => tube.includes(UNKNOWN))) warnings.push("判定できない色があります。グリッド位置や色の上書きを確認してください。");
    onConfirm({ tubes, capacity: CAPACITY, paletteRgb: palette, warnings });
  };

  const getClientPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wrapper = wrapperRef.current; if (!wrapper) return { x: 0, y: 0 };
    const rect = wrapper.getBoundingClientRect(); return { x: ((e.clientX - rect.left) / rect.width) * canvasSize.w, y: ((e.clientY - rect.top) / rect.height) * canvasSize.h };
  };
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasSize.w || !canvasSize.h) return;
    const p = getClientPoint(e);
    let best: { gridId: number; corner: Handle; distance: number } | null = null;
    for (const grid of grids) {
      const handles: { corner: Handle; point: Point }[] = [
        { corner: "tl", point: grid.corners.tl }, { corner: "tr", point: grid.corners.tr }, { corner: "bl", point: grid.corners.bl }, { corner: "br", point: grid.corners.br },
        { corner: "topCenter", point: { x: (grid.corners.tl.x + grid.corners.tr.x) / 2, y: (grid.corners.tl.y + grid.corners.tr.y) / 2 } },
        { corner: "bottomCenter", point: { x: (grid.corners.bl.x + grid.corners.br.x) / 2, y: (grid.corners.bl.y + grid.corners.br.y) / 2 } },
      ];
      for (const h of handles) { const d = Math.hypot(p.x - h.point.x, p.y - h.point.y); if (d <= HANDLE_HIT_R && (!best || d < best.distance)) best = { gridId: grid.id, corner: h.corner, distance: d }; }
    }
    if (best) {
      const grid = grids.find((g) => g.id === best!.gridId); if (!grid) return;
      setSelectedGridId(grid.id); dragMovedRef.current = false;
      setDragging({ gridId: grid.id, corner: best.corner, startX: p.x, startY: p.y, startClientX: e.clientX, startClientY: e.clientY, startCorners: grid.corners }); return;
    }
    let bestCell: { gridId: number; col: number; row: number; distance: number } | null = null;
    for (const grid of grids) {
      const points = gridPoints.get(grid.id); if (!points) continue;
      for (let r = 0; r < points.length; r++) for (let c = 0; c < points[r].length; c++) { const point = points[r][c], d = Math.hypot(p.x - point.x, p.y - point.y); if (d <= CELL_HIT_R && (!bestCell || d < bestCell.distance)) bestCell = { gridId: grid.id, col: c, row: r, distance: d }; }
    }
    if (bestCell) {
      if (colorSource) {
        setOverrides((prev) => { const next = new Map(prev); next.set(cellKey(bestCell!.gridId, bestCell!.col, bestCell!.row), colorSource); return next; });
        return;
      }
      openColorPicker(bestCell.gridId, bestCell.col, bestCell.row);
    }
  };

  const pickerOverride = colorPicker ? overrides.get(cellKey(colorPicker.gridId, colorPicker.col, colorPicker.row)) : undefined;
  const pickerGrid = colorPicker ? grids.find((g) => g.id === colorPicker.gridId) : undefined;

  return (
    <div className="space-y-4">
      <div ref={wrapperRef} className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border bg-black/5">
        <canvas ref={canvasRef} onPointerDown={handlePointerDown} className="block max-w-full touch-none" />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`} preserveAspectRatio="none">
          {grids.map((grid) => {
            const points = gridPoints.get(grid.id) ?? [], selected = grid.id === selectedGridId;
            return <g key={grid.id}>
              {points.map((row, r) => row.map((p, c) => { const key = cellKey(grid.id, c, r), rgb = previewColors.get(key), override = overrides.get(key); const fill = override === EMPTY ? "#ffffff" : override === UNKNOWN ? "#000000" : override && typeof override === "object" ? `rgb(${override.r}, ${override.g}, ${override.b})` : rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : "#ffffff"; return <circle key={`${r}-${c}`} cx={p.x} cy={p.y} r={3.5} fill={fill} stroke={selected ? "#2563eb" : "#64748b"} strokeWidth={1} opacity={0.95} />; }))}
              {selected && <>
                <line x1={grid.corners.tl.x} y1={grid.corners.tl.y} x2={grid.corners.tr.x} y2={grid.corners.tr.y} stroke="#2563eb" strokeWidth={1} />
                <line x1={grid.corners.bl.x} y1={grid.corners.bl.y} x2={grid.corners.br.x} y2={grid.corners.br.y} stroke="#2563eb" strokeWidth={1} />
                {(["tl", "tr", "bl", "br"] as (keyof Corners)[]).map((key) => <circle key={key} cx={grid.corners[key].x} cy={grid.corners[key].y} r={HANDLE_R} fill="#ffffff" stroke="#2563eb" strokeWidth={2} />)}
                <circle cx={(grid.corners.tl.x + grid.corners.tr.x) / 2} cy={(grid.corners.tl.y + grid.corners.tr.y) / 2} r={HANDLE_R} fill="#ffffff" stroke="#2563eb" strokeWidth={2} />
                <circle cx={(grid.corners.bl.x + grid.corners.br.x) / 2} cy={(grid.corners.bl.y + grid.corners.br.y) / 2} r={HANDLE_R} fill="#ffffff" stroke="#2563eb" strokeWidth={2} />
              </>}
            </g>;
          })}
        </svg>
        {colorSource && <div className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs shadow-lg">
          <span className="h-5 w-5 rounded-full border" style={{ backgroundColor: `rgb(${colorSource.r}, ${colorSource.g}, ${colorSource.b})` }} />
          <span>{colorSourceLabel ?? "選択中の色"}</span>
          <button type="button" onClick={() => { setColorSource(null); setColorSourceLabel(null); }} className="rounded border px-2 py-1">解除</button>
        </div>}
        {colorPicker && <div className="absolute left-1/2 top-12 z-20 w-[min(340px,calc(100%-16px))] -translate-x-1/2 rounded-lg border bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">色を選択</span><button type="button" onClick={() => setColorPicker(null)} className="text-sm text-gray-500">閉じる</button></div>
          <div className="mb-2 text-xs text-gray-500">設定先: グリッド{(pickerGrid?.id ?? 0) + 1} / {(colorPicker.col ?? 0) + 1}列 / {(colorPicker.row ?? 0) + 1}段</div>
          {colorSource && <button type="button" onClick={applyColorSource} className="mb-2 flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm hover:bg-gray-50"><span className="h-5 w-5 rounded-full border" style={{ backgroundColor: `rgb(${colorSource.r}, ${colorSource.g}, ${colorSource.b})` }} />選択中の色を設定</button>}
          <div className="grid grid-cols-2 gap-2">
            {detectedColors.map((rgb, index) => <button key={`${rgb.r}-${rgb.g}-${rgb.b}-${index}`} type="button" onClick={() => setColorOverride(rgb)} className="flex items-center gap-2 rounded border px-2 py-1.5 text-left text-sm hover:bg-gray-50"><span className="h-5 w-5 rounded-full border" style={{ backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` }} />色 {index + 1}</button>)}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setColorOverride("auto")} className="rounded border px-2 py-1.5 text-sm">自動</button>
            <button type="button" onClick={() => setColorOverride(EMPTY)} className="rounded border px-2 py-1.5 text-sm">空</button>
            <button type="button" onClick={() => setColorOverride(UNKNOWN)} className="rounded border px-2 py-1.5 text-sm">不明</button>
          </div>
          {pickerOverride && typeof pickerOverride === "object" && <div className="mt-2 text-xs text-gray-500">この交点は手動指定されています。</div>}
          <button type="button" onClick={() => pickColorFromIntersection(colorPicker.gridId, colorPicker.col, colorPicker.row)} className="mt-2 w-full rounded border px-2 py-1.5 text-sm">この交点の色を選択（スポイト）</button>
        </div>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={handleAddGrid} className="rounded border px-3 py-1.5 text-sm">g+</button>
        <button type="button" onClick={handleRemoveGrid} className="rounded border px-3 py-1.5 text-sm">g-</button>
        <button type="button" onClick={handleAddColumn} className="rounded border px-3 py-1.5 text-sm">c+</button>
        <button type="button" onClick={handleRemoveColumn} className="rounded border px-3 py-1.5 text-sm">c-</button>
        <button type="button" onClick={handleResetGrid} className="rounded border px-3 py-1.5 text-sm">Reset</button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <label className="text-sm">Empty tubes:<input value={emptyTubeCount} onChange={(e) => setEmptyTubeCount(e.target.value)} inputMode="numeric" className="ml-2 w-16 rounded border px-2 py-1 text-sm" /></label>
        <button type="button" onClick={onBack} className="rounded border px-3 py-1.5 text-sm">Back</button>
        <button type="button" onClick={handleSolveClick} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Solve</button>
      </div>
      {errorMsg && <p className="text-center text-sm text-red-600">{errorMsg}</p>}
    </div>
  );
};
