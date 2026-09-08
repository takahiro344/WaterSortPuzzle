import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AUTO, EMPTY, GridCell, RGB, UNKNOWN } from '../types';
import { clusterColors, inferUnknownColor } from '../colorLogic';

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

export interface GridConfirmResult {
  tubes: number[][]; // 下から上の順、EMPTYは含まない
  capacity: number; // 1本あたりの段数
  paletteRgb: (RGB | null)[]; // 色ID -> 代表色
  warnings: string[];
}

interface Props {
  image: HTMLImageElement;
  onBack: () => void;
  onConfirm: (result: GridConfirmResult) => void;
}

const HANDLE_R = 9;
const SAMPLE_RADIUS = 4;

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bilinear(corners: Corners, u: number, v: number): Point {
  const top = lerp(corners.tl, corners.tr, u);
  const bottom = lerp(corners.bl, corners.br, u);
  return lerp(top, bottom, v);
}

function sampleColorAt(ctx: CanvasRenderingContext2D, x: number, y: number): RGB {
  const size = SAMPLE_RADIUS * 2 + 1;
  const sx = Math.max(0, Math.round(x - SAMPLE_RADIUS));
  const sy = Math.max(0, Math.round(y - SAMPLE_RADIUS));
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
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

export const GridEditor: React.FC<Props> = ({ image, onBack, onConfirm }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [cols, setCols] = useState(8);
  const [rows, setRows] = useState(4);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [emptyTubeCount, setEmptyTubeCount] = useState(0);
  const [dragging, setDragging] = useState<keyof Corners | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewColors, setPreviewColors] = useState<Map<string, RGB>>(new Map());

  // 画像をcanvasに描画し、初期グリッド（内側90%程度）を設定する
  useEffect(() => {
    const maxW = Math.min(900, image.naturalWidth);
    const scale = maxW / image.naturalWidth;
    const w = Math.round(image.naturalWidth * scale);
    const h = Math.round(image.naturalHeight * scale);
    setCanvasSize({ w, h });

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, w, h);

    const marginX = w * 0.08;
    const marginY = h * 0.08;
    setCorners({
      tl: { x: marginX, y: marginY },
      tr: { x: w - marginX, y: marginY },
      bl: { x: marginX, y: h - marginY },
      br: { x: w - marginX, y: h - marginY },
    });
    setOverrides(new Map());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const gridPoints: Point[][] = useMemo(() => {
    if (!corners) return [];
    const pts: Point[][] = [];
    for (let r = 0; r < rows; r++) {
      const v = rows === 1 ? 0.5 : r / (rows - 1);
      const rowPts: Point[] = [];
      for (let c = 0; c < cols; c++) {
        const u = cols === 1 ? 0.5 : c / (cols - 1);
        rowPts.push(bilinear(corners, u, v));
      }
      pts.push(rowPts);
    }
    return pts;
  }, [corners, rows, cols]);

  // ポインタ操作でハンドルをドラッグ
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - rect.left, 0), canvasSize.w);
      const y = Math.min(Math.max(e.clientY - rect.top, 0), canvasSize.h);
      setCorners((prev) => (prev ? { ...prev, [dragging]: { x, y } } : prev));
    };
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, canvasSize]);

  const cellKey = (col: number, row: number) => `${col}-${row}`;

  // グリッド交点が動くたびに、プレビュー用の色をサンプリングし直す
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || gridPoints.length === 0) return;
    const map = new Map<string, RGB>();
    for (let r = 0; r < gridPoints.length; r++) {
      for (let c = 0; c < gridPoints[r].length; c++) {
        const p = gridPoints[r][c];
        map.set(cellKey(c, r), sampleColorAt(ctx, p.x, p.y));
      }
    }
    setPreviewColors(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridPoints]);

  const cycleOverride = (col: number, row: number) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const key = cellKey(col, row);
      const cur = next.get(key) ?? AUTO;
      if (cur === AUTO) {
        next.set(key, EMPTY);
      } else if (cur === EMPTY) {
        // 不明は全体で1個まで
        const alreadyUnknown = [...next.entries()].some(([k, v]) => v === UNKNOWN && k !== key);
        if (alreadyUnknown) {
          next.set(key, AUTO);
        } else {
          next.set(key, UNKNOWN);
        }
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const handleSolveClick = () => {
    setErrorMsg(null);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || gridPoints.length === 0) return;

    const cells: GridCell[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pt = gridPoints[r][c];
        const key = cellKey(c, r);
        const override = overrides.get(key);
        const rgb = sampleColorAt(ctx, pt.x, pt.y);
        cells.push({
          col: c,
          row: r,
          x: pt.x,
          y: pt.y,
          rgb,
          value: override ?? AUTO,
        });
      }
    }

    const { palette, assignedCells } = clusterColors(cells);
    const flatValues = assignedCells.map((c) => c.value);

    const inference = inferUnknownColor(flatValues, rows);
    const warnings: string[] = [];
    let resolvedValues = assignedCells;
    if (flatValues.includes(UNKNOWN)) {
      if (!inference.ok || inference.inferredColor === null) {
        setErrorMsg(inference.message);
        return;
      }
      warnings.push(inference.message);
      resolvedValues = assignedCells.map((c) =>
        c.value === UNKNOWN ? { ...c, value: inference.inferredColor as number } : c
      );
    }

    // 列(試験管)ごとに、下(row=rows-1)→上(row=0)の順で色を並べる。EMPTYは除外。
    const tubes: number[][] = [];
    for (let c = 0; c < cols; c++) {
      const tube: number[] = [];
      for (let r = rows - 1; r >= 0; r--) {
        const cell = resolvedValues.find((cc) => cc.col === c && cc.row === r);
        if (cell && cell.value !== EMPTY) tube.push(cell.value);
      }
      tubes.push(tube);
    }
    for (let i = 0; i < emptyTubeCount; i++) tubes.push([]);

    const paletteRgb: (RGB | null)[] = palette.slice();
    if (inference.inferredColor !== null && inference.inferredColor >= palette.length) {
      paletteRgb.push(null);
    }

    onConfirm({ tubes, capacity: rows, paletteRgb, warnings });
  };

  return (
    <div className="step-panel">
      <h2>(2/3) グリッドで色取得</h2>
      <ol className="instructions">
        <li>四隅の丸いハンドルをドラッグして、各試験管の色の中心に交点が来るように調整してください。</li>
        <li>c- / c+ で試験管の本数（列）を、g- / g+ で1本あたりの段数（行）を調整できます。</li>
        <li>交点をクリックすると 自動 → 空 → 不明 → 自動 の順に切り替わります（不明は1箇所まで）。</li>
      </ol>

      <div className="grid-controls">
        <span>試験管の数(列): {cols}</span>
        <button onClick={() => setCols((v) => Math.max(1, v - 1))}>c-</button>
        <button onClick={() => setCols((v) => v + 1)}>c+</button>
        <span>段数(行): {rows}</span>
        <button onClick={() => setRows((v) => Math.max(2, v - 1))}>g-</button>
        <button onClick={() => setRows((v) => v + 1)}>g+</button>
      </div>

      <div
        className="canvas-wrapper"
        ref={wrapperRef}
        style={{ width: canvasSize.w, height: canvasSize.h }}
      >
        <canvas ref={canvasRef} />
        {corners && (
          <svg
            className="grid-overlay"
            width={canvasSize.w}
            height={canvasSize.h}
            viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
          >
            {/* 行方向の線 */}
            {gridPoints.map((rowPts, r) => (
              <polyline
                key={`row-${r}`}
                points={rowPts.map((p) => `${p.x},${p.y}`).join(' ')}
                className="grid-line"
              />
            ))}
            {/* 列方向の線 */}
            {cols > 0 &&
              Array.from({ length: cols }).map((_, c) => (
                <polyline
                  key={`col-${c}`}
                  points={gridPoints.map((rowPts) => `${rowPts[c].x},${rowPts[c].y}`).join(' ')}
                  className="grid-line"
                />
              ))}
            {/* 交点 */}
            {gridPoints.map((rowPts, r) =>
              rowPts.map((p, c) => {
                const key = cellKey(c, r);
                const ov = overrides.get(key);
                const sampled = previewColors.get(key);
                let fill = sampled ? `rgb(${sampled.r},${sampled.g},${sampled.b})` : 'rgba(255,255,255,0.6)';
                let label = '';
                if (ov === EMPTY) {
                  fill = '#888';
                  label = '空';
                } else if (ov === UNKNOWN) {
                  fill = '#ff0';
                  label = '?';
                }
                return (
                  <g
                    key={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      cycleOverride(c, r);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle cx={p.x} cy={p.y} r={7} fill={fill} stroke="#000" strokeWidth={1} />
                    {label && (
                      <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={10} fill="#000">
                        {label}
                      </text>
                    )}
                  </g>
                );
              })
            )}
            {/* 四隅ハンドル */}
            {(Object.keys(corners) as (keyof Corners)[]).map((k) => {
              const p = corners[k];
              return (
                <circle
                  key={k}
                  cx={p.x}
                  cy={p.y}
                  r={HANDLE_R}
                  className="corner-handle"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDragging(k);
                  }}
                />
              );
            })}
          </svg>
        )}
      </div>

      <div className="empty-tube-input">
        <label>
          空の試験管の数:
          <input
            type="number"
            min={0}
            value={emptyTubeCount}
            onChange={(e) => setEmptyTubeCount(Math.max(0, parseInt(e.target.value || '0', 10)))}
          />
        </label>
      </div>

      {errorMsg && <p className="error-msg">{errorMsg}</p>}

      <div className="button-row">
        <button onClick={onBack}>戻る</button>
        <button className="primary" onClick={handleSolveClick}>
          解く
        </button>
      </div>
    </div>
  );
};
