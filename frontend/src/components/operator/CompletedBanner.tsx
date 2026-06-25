import React from "react";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CompletedBannerProps {
  winnerDisplayName: string;
  winMethodText: string;
  busy: boolean;
  onNextMatch?: () => void;
}

export const CompletedBanner: React.FC<CompletedBannerProps> = ({
  winnerDisplayName,
  winMethodText,
  busy,
  onNextMatch,
}) => {
  return (
    <div className="p-4 rounded-xl border border-green-500/30 bg-green-950/20 text-green-300 text-center space-y-2">
      <div className="text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1">
        <Trophy className="w-4 h-4 text-yellow-500 animate-bounce" /> Бій завершено!
      </div>
      <div className="text-lg font-black uppercase text-white">
        Переможець: {winnerDisplayName}
      </div>
      <div className="text-xs opacity-75 italic">
        Спосіб перемоги: {winMethodText}
      </div>
      {onNextMatch && (
        <Button
          size="sm"
          disabled={busy}
          onClick={onNextMatch}
          className="bg-amber-500 hover:bg-amber-600 text-black font-bold px-6 py-2 uppercase text-xs"
        >
          Наступний бій
        </Button>
      )}
    </div>
  );
};
