import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

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
  return (
    <div className="space-y-1.5 p-3 border border-border rounded-lg bg-muted/20">
      <Label>{label}</Label>
      <Input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            onFileChange(files[0]);
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
    </div>
  );
}
