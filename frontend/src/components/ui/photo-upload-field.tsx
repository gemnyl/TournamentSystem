import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useRef, useState } from "react";
import { ImageCropperDialog } from "@/components/ui/image-cropper-dialog";

interface PhotoUploadFieldProps {
  label?: string;
  selectedFile: File | null;
  onFileChange: (file: File | null) => void;
  currentPhotoUrl?: string | null;
}

export function PhotoUploadField({
  label = "Фото профілю",
  selectedFile,
  onFileChange,
  currentPhotoUrl,
}: Readonly<PhotoUploadFieldProps>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);

  return (
    <div className="space-y-1.5 p-3 border border-border rounded-lg bg-muted/20">
      <Label>{label}</Label>
      <Input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            const file = files[0];
            if (!file.type.startsWith("image/")) {
              toast({
                variant: "destructive",
                title: "Некоректний формат файлу",
                description: "Будь ласка, виберіть зображення (JPEG, PNG, WebP тощо).",
              });
              if (fileInputRef.current) {
                fileInputRef.current.value = "";
              }
              onFileChange(null);
              return;
            }

            const maxSizeBytes = 10 * 1024 * 1024; // 10 MB
            if (file.size > maxSizeBytes) {
              toast({
                variant: "destructive",
                title: "Файл занадто великий",
                description: "Будь ласка, виберіть зображення розміром менше 10 МБ.",
              });
              if (fileInputRef.current) {
                fileInputRef.current.value = "";
              }
              onFileChange(null);
              return;
            }
            setPendingFile(file);
            setIsCropperOpen(true);
          } else {
            onFileChange(null);
          }
        }}
      />
      {(selectedFile || currentPhotoUrl) && (
        <div className="flex items-center gap-3 mt-3">
          <div className="w-12 h-12 rounded-full overflow-hidden border border-border bg-muted">
            <img
              src={selectedFile ? URL.createObjectURL(selectedFile) : currentPhotoUrl ?? ""}
              alt="Preview"
              className="w-full h-full object-cover"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {selectedFile ? "Нове фото обрано" : "Поточне фото профілю"}
          </span>
        </div>
      )}

      <ImageCropperDialog
        file={pendingFile}
        open={isCropperOpen}
        onClose={() => {
          setIsCropperOpen(false);
          setPendingFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }}
        onConfirm={(croppedFile) => {
          onFileChange(croppedFile);
          setIsCropperOpen(false);
          setPendingFile(null);
        }}
      />
    </div>
  );
}
