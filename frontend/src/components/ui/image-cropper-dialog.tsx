import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface ImageCropperDialogProps {
  file: File | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (croppedFile: File) => void;
}

export function ImageCropperDialog({
  file,
  open,
  onClose,
  onConfirm,
}: Readonly<ImageCropperDialogProps>) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [imgStyle, setImgStyle] = useState<{ width: string; height: string }>({
    width: "250px",
    height: "auto",
  });
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setImgUrl(url);
      setZoom(1);
      setPosition({ x: 0, y: 0 });
      setImgStyle({ width: "250px", height: "auto" });
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setImgUrl(null);
    }
  }, [file]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth < img.naturalHeight) {
      setImgStyle({ width: "250px", height: "auto" });
    } else {
      setImgStyle({ width: "auto", height: "250px" });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStart.current = {
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setPosition({
      x: e.touches[0].clientX - dragStart.current.x,
      y: e.touches[0].clientY - dragStart.current.y,
    });
  };

  const handleConfirm = () => {
    if (!imgRef.current || !file) return;

    const img = imgRef.current;
    const canvas = document.createElement("canvas");
    const cropSize = 300; // Output cropped image resolution
    canvas.width = cropSize;
    canvas.height = cropSize;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cropSize, cropSize);

      const containerSize = 250;
      const imgWidth = img.clientWidth || img.width || 250;
      const imgHeight = img.clientHeight || img.height || 250;
      const scale = img.naturalWidth / imgWidth;

      const sourceX = (imgWidth / 2 - position.x / zoom - (containerSize / 2) / zoom) * scale;
      const sourceY = (imgHeight / 2 - position.y / zoom - (containerSize / 2) / zoom) * scale;
      const sourceWidth = (containerSize / zoom) * scale;
      const sourceHeight = (containerSize / zoom) * scale;

      try {
        ctx.drawImage(
          img,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          cropSize,
          cropSize
        );

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const cropped = new File([blob], file.name, {
                type: file.type,
                lastModified: Date.now(),
              });
              onConfirm(cropped);
            }
          },
          file.type,
          0.9
        );
      } catch (err) {
        console.error("Canvas crop drawing failed:", err);
        onClose();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 5;
    if (e.key === "ArrowLeft") {
      setPosition((prev) => ({ ...prev, x: prev.x - step }));
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      setPosition((prev) => ({ ...prev, x: prev.x + step }));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setPosition((prev) => ({ ...prev, y: prev.y - step }));
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      setPosition((prev) => ({ ...prev, y: prev.y + step }));
      e.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Налаштування та обрізка фото</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center p-4 space-y-4">
          {/* Crop area wrapper */}
          <div
            ref={containerRef}
            className="w-[250px] h-[250px] rounded-full border-2 border-amber-500 overflow-hidden relative bg-slate-950 cursor-move select-none flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-amber-500"
            style={{
              transform: "translateZ(0)",
              WebkitTransform: "translateZ(0)",
              isolation: "isolate",
              WebkitMaskImage: "-webkit-radial-gradient(white, black)",
            }}
            role="button"
            tabIndex={0}
            aria-label="Область обрізки фотографії. Використовуйте стрілки на клавіатурі для точного позиціонування."
            onKeyDown={handleKeyDown}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUpOrLeave}
            onMouseLeave={handleMouseUpOrLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleMouseUpOrLeave}
          >
            {imgUrl && (
              <img
                ref={imgRef}
                src={imgUrl}
                alt="Crop preview"
                onLoad={handleImageLoad}
                className="max-w-none pointer-events-none origin-center"
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                  width: imgStyle.width,
                  height: imgStyle.height,
                }}
              />
            )}
            {/* Center circle overlay guide */}
            <div className="absolute inset-0 rounded-full border border-white/20 pointer-events-none" />
          </div>

          <div className="w-full space-y-1.5 px-4">
            <div className="flex justify-between text-xs text-slate-400">
              <Label>Масштаб</Label>
              <span>{Math.round(zoom * 100)}%</span>
            </div>
            <input
              type="range"
              min="1"
              max="4"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number.parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <p className="text-[11px] text-slate-500 text-center mt-1">
              Перетягуйте зображення мишкою або пальцем, щоб вирівняти його по колу.
            </p>
          </div>
        </div>

        <DialogFooter className="flex sm:justify-end gap-2 px-4">
          <Button
            variant="outline"
            className="border-slate-800 hover:bg-slate-800 bg-slate-950 text-slate-300"
            onClick={onClose}
          >
            Скасувати
          </Button>
          <Button
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold"
            onClick={handleConfirm}
          >
            Зберегти
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
