import { Loader2 } from "lucide-react";

export function PrintErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-955 text-white p-4">
      <p className="font-semibold text-red-400">{message}</p>
    </div>
  );
}

export function PrintLoadingState({
  message = "Завантаження сіток...",
  progress
}: {
  message?: string;
  progress?: number;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-955 text-white gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      <p className="text-zinc-400 text-sm font-medium animate-pulse">
        {message} {progress !== undefined && `(${progress}%)`}
      </p>
      {progress !== undefined && (
        <div className="w-48 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

export function PrintNoAccessState() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-955 text-white p-4">
      <p className="font-semibold text-red-400 text-center">
        У вас немає доступу до цієї сторінки. Тільки адміністратори, організатори турніру та судді мають право друку сіток.
      </p>
    </div>
  );
}

interface PrintHeaderToolbarProps {
  onBack?: () => void;
  onPrint?: () => void;
  onDownload: () => void;
  printLabel?: string;
}

export function PrintHeaderToolbar({
  onBack = () => window.history.back(),
  onPrint = () => window.print(),
  onDownload,
  printLabel = "Друк сітки",
}: PrintHeaderToolbarProps) {
  return (
    <div className="w-full flex justify-between items-center bg-zinc-955 border-b border-zinc-800 px-6 py-4 shadow-xl no-print">
      <button
        onClick={onBack}
        className="px-4 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700 transition-all border border-zinc-700"
      >
        Назад
      </button>
      <div className="flex gap-3">
        <button
          onClick={onPrint}
          className="px-4 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700 transition-all border border-zinc-700"
        >
          {printLabel}
        </button>
        <button
          onClick={onDownload}
          className="px-4 py-1.5 rounded-lg bg-amber-500 text-zinc-950 text-xs font-black hover:bg-amber-400 transition-all shadow-md shadow-amber-500/10"
        >
          Завантажити PDF
        </button>
      </div>
    </div>
  );
}
