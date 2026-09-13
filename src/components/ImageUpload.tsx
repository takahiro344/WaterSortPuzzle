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
      <h2>画像を読み込む</h2>

      <ol className="instructions">
        <li>
          パズルを開始する前の画面をスクリーンショットしてください。
          スマートフォンの画面を別の端末で撮影した画像も利用できます。
        </li>
        <li>
          下のエリアをクリックして画像を選択するか、画像ファイルをドラッグしてください。
        </li>
      </ol>

      <div
        className="dropzone"
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        画像ファイルを選択
        <span className="dropzone-subtext">またはここへドラッグ</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onChange}
        />
      </div>

      <p className="note">読み込んだ画像はこのブラウザ上でのみ処理されます。</p>
    </div>
  );
};
