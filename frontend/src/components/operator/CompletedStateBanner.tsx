import React from "react";
import { Trophy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CompletedStateBannerProps {
  winnerName: string | null;
  winMethod: string | null;
  busy: boolean;
  onReset: () => void;
  onNextMatch?: () => void;
}

export const CompletedStateBanner: React.FC<CompletedStateBannerProps> = ({
  winnerName,
  winMethod,
  busy,
  onReset,
  onNextMatch,
}) => {
  return (
    <div className="p-4 rounded-xl border border-green-500/30 bg-green-950/20 text-green-300 text-center space-y-2">
      <div className="text-sm font-bold flex items-center justify-center gap-1.5">
        <Trophy className="h-4 w-4 text-yellow-500 animate-bounce" />
        Матч завершено
      </div>
      {winnerName && (
        <p className="text-xs text-green-400">
          Переможець: <strong className="font-extrabold uppercase">{winnerName}</strong>{winMethod ? ` (${winMethod})` : ""}
        </p>
      )}
      <div className="flex gap-2 justify-center pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={busy}
          className="h-8 text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Скинути результат
        </Button>
        {onNextMatch && (
          <Button
            variant="default"
            size="sm"
            onClick={onNextMatch}
            className="h-8 text-xs font-bold bg-green-600 hover:bg-green-700 text-white border-0"
          >
            Наступний матч
          </Button>
        )}
      </div>
    </div>
  );
};
