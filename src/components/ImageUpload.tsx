import React, { useCallback, useRef } from "react";

interface Props {
  onImageLoaded: (img: HTMLImageElement) => void;
}

export const ImageUpload: React.FC<Props> = ({ onImageLoaded }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => onImageLoaded(img);
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    },
    [onImageLoaded],
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="step-panel">
      <h2>(1/3) 画像ファイル選択</h2>
      <ol className="instructions">
        <li>
          Water Sort Puzzle
          で、まだひとつも動かしていない時点でスクリーンショットを撮ってください。スマホのカメラで別のスマホを撮影した画像でも構いません。
        </li>
        <li>
          下のボタンから画像を選択するか、この枠にドラッグ＆ドロップしてください。
        </li>
      </ol>
      <div
        className="dropzone"
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        画像をここにドロップ、またはクリックして選択
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onChange}
        />
      </div>
      <p className="note">
        画像はブラウザ内でのみ処理され、サーバーへは送信されません。
      </p>
    </div>
  );
};
