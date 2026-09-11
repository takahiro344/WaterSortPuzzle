import { RGB } from "./types";

// クラスタリングで得た実際のRGBがあればそれを使い、無ければ固定パレットから割り当てる
const FALLBACK_PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#46f0f0",
  "#f032e6",
  "#bcf60c",
  "#fabebe",
  "#008080",
  "#e6beff",
  "#9a6324",
  "#800000",
  "#aaffc3",
  "#808000",
  "#ffd8b1",
  "#000075",
  "#808080",
  "#000000",
];

export function displayColorFor(colorId: number, rgb?: RGB | null): string {
  if (rgb) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }
  return FALLBACK_PALETTE[colorId % FALLBACK_PALETTE.length];
}

export function contrastTextColor(rgb: RGB): string {
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 150 ? "#000" : "#fff";
}
