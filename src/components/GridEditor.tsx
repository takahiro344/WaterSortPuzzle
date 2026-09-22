import React, { useEffect, useRef, useState } from "react";
import { CLUSTER_THRESHOLD } from "../colorLogic";
import { sampleColorAt } from "../pixelSampling";
import type { RGB } from "../types";
import type { AmbiguousCell, GridConfirmResult } from "./GridEditorBase";
import { GridEditor as BaseGridEditor } from "./GridEditorBase";

export type { AmbiguousCell, GridConfirmResult } from "./GridEditorBase";

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

// 交点に複数候補が指定されているとき、盤面上での目印として使う破線ストロークの設定。
const MULTI_CANDIDATE_STROKE = "#000";
const MULTI_CANDIDATE_DASH = "2,1.5";

export const GridEditor: React.FC<Props> = ({ image, onBack, onConfirm }) => {
  const [selectedCell, setSelectedCell] = useState<CellRef | null>(null);
  // 色選択ボックスで現在チェックが入っている候補色（適用前の編集中の状態）。
  // 1個なら通常の単一指定、2個以上なら「このうちのどれか」という曖昧指定になる。
  const [pendingColors, setPendingColors] = useState<string[]>([]);
  const [availableColors, setAvailableColors] = useState<RGB[]>([]);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [colorPickerPosition, setColorPickerPosition] = useState({
    left: 0,
    top: 0,
  });
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  // セルキー -> 手動指定した候補色（hex）の配列。要素数が2以上のセルが曖昧セル。
  const overridesRef = useRef(new Map<string, string[]>());

  useEffect(() => {
    overridesRef.current.clear();
    setSelectedCell(null);
    setPendingColors([]);
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

      for (const [key, hexColors] of overridesRef.current) {
        if (hexColors.length === 0) continue;
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
        if (!circle) continue;

        const fillHex = hexColors[0];
        if (circle.getAttribute("fill") !== fillHex) {
          circle.setAttribute("fill", fillHex);
        }
        // 候補が複数ある曖昧セルは、盤面上でも破線の縁取りで見分けられるようにする。
        if (hexColors.length > 1) {
          if (circle.getAttribute("stroke") !== MULTI_CANDIDATE_STROKE) {
            circle.setAttribute("stroke", MULTI_CANDIDATE_STROKE);
          }
          if (circle.getAttribute("stroke-dasharray") !== MULTI_CANDIDATE_DASH) {
            circle.setAttribute("stroke-dasharray", MULTI_CANDIDATE_DASH);
          }
        } else if (circle.getAttribute("stroke-dasharray")) {
          circle.removeAttribute("stroke-dasharray");
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
    if (!selectedCell) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !colorPickerRef.current?.contains(target)) {
        setIsColorPickerOpen(false);
        setSelectedCell(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsColorPickerOpen(false);
        setSelectedCell(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedCell]);

  const sampleCellColor = (cell: CellRef): RGB | null => {
    const key = `${cell.grid}-${cell.col}-${cell.row}`;
    const override = overridesRef.current.get(key);
    if (override && override.length > 0) return hexToRgb(override[0]);

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

    return sampleColorAt(ctx, x, y);
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

      // 交点ごとに「現在表示されている色」を集計する。
      // 手動指定済みの交点は overridesRef の色を優先することで、
      // 「画像判定3個 + 手動指定1個 = 4個」のようなケースも正しく数える。
      const colorGroups: {
        color: RGB;
        count: number;
        sumR: number;
        sumG: number;
        sumB: number;
      }[] = [];
      const grids = Array.from(
        document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
      );

      grids.forEach((svg, grid) => {
        const hitCircles = Array.from(
          svg.querySelectorAll<SVGCircleElement>('circle[r="10"]'),
        );
        // 選択中のグリッドは、四隅のドラッグハンドル用に同じ座標へ
        // 半径 4.2 の丸をもう一つ重ねて描画している(GridEditorBase の
        // renderHandle)。querySelectorAll はそれも一緒に拾ってしまうため、
        // 本来のマス数(hitCircles.length)分だけに絞り、四隅のセルが
        // 二重カウントされないようにする。
        const circles = Array.from(
          svg.querySelectorAll<SVGCircleElement>('circle[r="4.2"]'),
        ).slice(0, hitCircles.length);
        const cols = Math.max(1, hitCircles.length / 4);

        circles.forEach((circle, index) => {
          const x = Number(circle.getAttribute("cx"));
          const y = Number(circle.getAttribute("cy"));
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;

          const cell: CellRef = {
            grid,
            col: index % cols,
            row: Math.floor(index / cols),
          };
          const key = `${cell.grid}-${cell.col}-${cell.row}`;
          const override = overridesRef.current.get(key);
          // 複数候補が選ばれている「曖昧セル」は、まだ色が確定していないので
          // 候補色一覧の集計対象から除外する（暫定値を確定した色として
          // 数えてしまうと、他の交点の候補色一覧にその暫定値が紛れ込んでしまう）。
          if (override && override.length > 1) return;
          const rgb =
            override && override.length === 1
              ? hexToRgb(override[0])
              : sampleColorAt(ctx, x, y);

          // 「最初に閾値内で見つかったグループ」ではなく「最も近いグループ」に
          // 割り当てる。複数の色が閾値内に競合する場合でも、実際の求解時に
          // colorLogic.ts の clusterColors が行うクラスタリングと結果が
          // ずれないようにするため。
          let bestGroup: {
            color: RGB;
            count: number;
            sumR: number;
            sumG: number;
            sumB: number;
          } | null = null;
          let bestDist = Infinity;
          for (const existing of colorGroups) {
            const d = rgbDistance(existing.color, rgb);
            if (d <= 36 && d < bestDist) {
              bestDist = d;
              bestGroup = existing;
            }
          }
          if (bestGroup) {
            // 代表色は「最初に合流した1ピクセル」に固定せず、そのグループに
            // 合流した全ピクセルの平均値（重心）を都度更新する。こうしないと、
            // colorLogic.ts の clusterColors（重心更新済み）と代表色がずれて、
            // ここで選んだ候補色が求解時に別の色IDへ解決されてしまうことがある。
            bestGroup.sumR += rgb.r;
            bestGroup.sumG += rgb.g;
            bestGroup.sumB += rgb.b;
            bestGroup.count++;
            bestGroup.color = {
              r: Math.round(bestGroup.sumR / bestGroup.count),
              g: Math.round(bestGroup.sumG / bestGroup.count),
              b: Math.round(bestGroup.sumB / bestGroup.count),
            };
          } else {
            colorGroups.push({
              color: rgb,
              count: 1,
              sumR: rgb.r,
              sumG: rgb.g,
              sumB: rgb.b,
            });
          }
        });
      });

      // すでに4個検出済みの色は、もう候補として選ぶ必要がないため一覧から除外する。
      return colorGroups
        .filter((group) => group.count < 4)
        .map((group) => group.color);
    };

    const openPicker = (cell: CellRef) => {
      const key = `${cell.grid}-${cell.col}-${cell.row}`;
      const current = overridesRef.current.get(key);
      const colors = collectAvailableColors();
      setAvailableColors(colors);
      // 既に手動指定済みならその候補を引き継ぎ、未指定なら何もチェックしない
      // 状態で開く（自動判定色を勝手に選択済みにしない）。
      setPendingColors(current && current.length > 0 ? [...current] : []);

      // 色選択UIを、クリックした交点の少し上に表示する。
      const grids = Array.from(
        document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
      );
      const svg = grids[cell.grid];
      if (svg) {
        const hitCircles = Array.from(
          svg.querySelectorAll<SVGCircleElement>('circle[r="10"]'),
        );
        const cols = Math.max(1, hitCircles.length / 4);
        const hitCircle = hitCircles[cell.row * cols + cell.col];
        if (hitCircle) {
          const rect = hitCircle.getBoundingClientRect();
          setColorPickerPosition({
            left: rect.left + rect.width / 2,
            top: rect.top - 8,
          });
        }
      }

      setSelectedCell(cell);
    };

    const findCellAtPoint = (
      clientX: number,
      clientY: number,
    ): CellRef | null => {
      const grids = Array.from(
        document.querySelectorAll<SVGSVGElement>(".grid-overlay"),
      );
      const best: { match: { cell: CellRef; distance: number } | null } = {
        match: null,
      };

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
          if (!best.match || distance < best.match.distance) {
            best.match = { cell, distance };
          }
        });
      });

      return best.match?.cell ?? null;
    };

    const handlePointerStart = new Map<
      number,
      { x: number; y: number; cell: CellRef; target: SVGElement }
    >();
    const delegatedPointerIds = new Set<number>();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && colorPickerRef.current?.contains(target)) {
        return;
      }

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
    if (!selectedCell || pendingColors.length === 0) return;
    const key = `${selectedCell.grid}-${selectedCell.col}-${selectedCell.row}`;
    overridesRef.current.set(key, [...pendingColors]);

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
      if (circle) {
        circle.setAttribute("fill", pendingColors[0]);
        if (pendingColors.length > 1) {
          circle.setAttribute("stroke", MULTI_CANDIDATE_STROKE);
          circle.setAttribute("stroke-dasharray", MULTI_CANDIDATE_DASH);
        } else {
          circle.removeAttribute("stroke-dasharray");
        }
      }
    }

    setSelectedCell(null);
  };

  const resetColor = () => {
    if (!selectedCell) return;

    const key = `${selectedCell.grid}-${selectedCell.col}-${selectedCell.row}`;
    overridesRef.current.delete(key);

    // 手動指定を解除し、画像から自動判定した色を表示する。
    const autoColor = sampleCellColor(selectedCell);
    if (autoColor) {
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
        if (circle) {
          circle.setAttribute("fill", rgbToHex(autoColor));
          circle.removeAttribute("stroke-dasharray");
        }
      }
    }

    setPendingColors(autoColor ? [rgbToHex(autoColor)] : []);
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
    const ambiguousCells: AmbiguousCell[] = [];
    // 単一色に確定済みのセルが使った色ID（=もう他の曖昧セルの候補になり得ない色）
    const fixedColorIds = new Set<number>();
    let tubeOffset = 0;

    // hex色を既存パレットのIDに解決する。同じ色は同じIDを再利用する。
    // 候補色のhexを既存パレットの色IDに対応付ける。単純な「距離1未満」の
    // ほぼ完全一致判定だと、候補色一覧の集計(collectAvailableColors)と
    // 自動クラスタリング(colorLogic.clusterColors)が別々にピクセルを
    // サンプリングしているせいで生じるごくわずかな誤差でも別の色として
    // 扱われてしまい、本来同じ色のはずの交点が「孤立した1個だけの色」に
    // なってしまう（＝どの組み合わせを試しても解けない）不具合があったため、
    // 自動クラスタリングと同じ基準(CLUSTER_THRESHOLD)で最も近い色を採用する。
    const resolveHexToPaletteIndex = (hex: string): number => {
      const rgb = hexToRgb(hex);
      let paletteIndex = -1;
      let bestDist = Infinity;
      palette.forEach((candidate, index) => {
        if (!candidate) return;
        const d = rgbDistance(candidate, rgb);
        if (d < bestDist) {
          bestDist = d;
          paletteIndex = index;
        }
      });
      if (paletteIndex < 0 || bestDist > CLUSTER_THRESHOLD) {
        paletteIndex = palette.length;
        palette.push(rgb);
      }
      return paletteIndex;
    };

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
          const hexColors = overridesRef.current.get(key);
          if (!hexColors || hexColors.length === 0) continue;

          const colorIds = hexColors.map(resolveHexToPaletteIndex);
          const position = 3 - row;
          // position が現在の配列長を超える場合でも、直接インデックス代入すれば
          // JS配列が自動的に伸長されるので、常に正しい位置に値が入る。
          // （以前は position >= length のとき push していたが、EMPTYだった
          // 上側の複数マスをまとめて手動指定すると配列末尾に積まれてしまい、
          // 別の行の position と同じインデックスに衝突することがあった）
          tubes[tubeIndex][position] = colorIds[0];
          const actualIndex = position;

          // 候補が複数ある場合は「暫定でcolorIds[0]を入れているが、
          // 求解時にはcolorIdsの組み合わせをすべて自動で試す」曖昧セルとして記録する。
          if (colorIds.length > 1) {
            ambiguousCells.push({
              tubeIndex,
              position: actualIndex,
              colorIds,
            });
          } else {
            // 単一色に確定したセル。この色IDはもう他の曖昧セルの候補として
            // 使えない（同じ色を二重に使うことになり、盤面として成立しないため）。
            fixedColorIds.add(colorIds[0]);
          }
        }
      }
      tubeOffset += cols;
    });

    // 曖昧セルの候補から、既に他のセルで単一色として確定済みの色を除外する。
    // ユーザーがチェックを外し忘れていても、ここで自動的に矛盾を防ぐ。
    for (const cell of ambiguousCells) {
      cell.colorIds = cell.colorIds.filter((id) => !fixedColorIds.has(id));
    }

    onConfirm({ ...result, tubes, paletteRgb: palette, ambiguousCells });
  };

  return (
    <div style={{ position: "relative" }}>
      <BaseGridEditor image={image} onBack={onBack} onConfirm={handleConfirm} />
      {selectedCell && (
        <div
          ref={colorPickerRef}
          style={{
            position: "fixed",
            left: colorPickerPosition.left,
            top: colorPickerPosition.top,
            transform: "translate(-50%, -100%)",
            zIndex: 1000,
            padding: 10,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 5,
            boxShadow: "0 4px 16px rgba(0,0,0,.2)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 14,
            maxWidth: "min(720px, calc(100vw - 32px))",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              width: 180,
            }}
          >
            <label id="grid-color-select-label">
              指定する色（複数選択可）
            </label>
            <div style={{ position: "relative", minWidth: 72 }}>
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
                  height: 29,
                  padding: "3px 26px 3px 6px",
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid #888",
                  borderRadius: 5,
                  background: "#fff",
                  cursor: availableColors.length === 0 ? "default" : "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 19,
                    height: 19,
                    flexShrink: 0,
                    display: "flex",
                    overflow: "hidden",
                    borderRadius: 3,
                    border: "1px solid #888",
                  }}
                >
                  {pendingColors.map((hex, i) => (
                    <span key={i} style={{ flex: 1, background: hex }} />
                  ))}
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 11,
                    width: 0,
                    height: 0,
                    borderLeft: "4px solid transparent",
                    borderRight: "4px solid transparent",
                    borderTop: "5px solid #555",
                  }}
                />
              </button>

              {isColorPickerOpen && availableColors.length > 0 && (
                <div
                  role="listbox"
                  aria-multiselectable="true"
                  aria-label="認識された色（複数選択可）"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "calc(100% + 3px)",
                    zIndex: 1001,
                    width: "100%",
                    maxHeight: 176,
                    overflowY: "auto",
                    padding: 4,
                    boxSizing: "border-box",
                    background: "#fff",
                    border: "1px solid #888",
                    borderRadius: 5,
                    boxShadow: "0 4px 12px rgba(0,0,0,.2)",
                  }}
                >
                  {availableColors.map((rgb, index) => {
                    const hex = rgbToHex(rgb);
                    const selected = pendingColors.some(
                      (c) => c.toLowerCase() === hex.toLowerCase(),
                    );

                    return (
                      <button
                        key={`${hex}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={
                          selected ? "この色の指定を解除" : "この色を候補に追加"
                        }
                        onClick={() => {
                          setPendingColors((prev) => {
                            const exists = prev.some(
                              (c) => c.toLowerCase() === hex.toLowerCase(),
                            );
                            if (exists) {
                              return prev.filter(
                                (c) => c.toLowerCase() !== hex.toLowerCase(),
                              );
                            }
                            return [...prev, hex];
                          });
                        }}
                        style={{
                          width: "100%",
                          height: 32,
                          padding: 4,
                          margin: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          border: selected
                            ? "2px solid #000"
                            : "2px solid transparent",
                          borderRadius: 3,
                          background: selected ? "#eee" : "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 24,
                            height: 24,
                            flexShrink: 0,
                            borderRadius: 3,
                            border: "1px solid #888",
                            background: hex,
                          }}
                        />
                        {selected && <span aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {availableColors.length === 0 && (
            <span style={{ color: "#666" }}>利用できる色候補がありません</span>
          )}

          <button
            type="button"
            onClick={applyColor}
            disabled={availableColors.length === 0 || pendingColors.length === 0}
            style={{
              height: 29,
              whiteSpace: "nowrap",
              fontSize: 13,
              padding: "0 8px",
            }}
          >
            色を反映
          </button>
          <button
            type="button"
            onClick={resetColor}
            style={{
              height: 29,
              whiteSpace: "nowrap",
              fontSize: 13,
              padding: "0 8px",
            }}
          >
            自動認識に戻す
          </button>
        </div>
      )}
    </div>
  );
};
