import { RGB } from "./types";

export const SAMPLE_RADIUS = 4;

// 交点付近のピクセルを平均して色を取得する。
// 中心点がグリッド線・ハイライト・色の境目に重なっていると彩度が
// 落ちた（白っぽい/灰色がかった）色を拾ってしまうことがあるため、
// 中心の彩度が低い場合は周囲8点も調べ、最も彩度が高いサンプルを採用する。
export function sampleColorAt(
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
