import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WinnerSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  winnerName: string;
  winnerColorClass: string;
  winMethod: string;
  onWinMethodChange: (method: string) => void;
  options: { value: string; label: string }[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const WinnerSelectDialog: React.FC<WinnerSelectDialogProps> = ({
  open,
  onOpenChange,
  winnerName,
  winnerColorClass,
  winMethod,
  onWinMethodChange,
  options,
  busy,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 text-white border-zinc-800">
        <DialogHeader>
          <DialogTitle>
            Оголосити переможця:{" "}
            <span className={winnerColorClass}>
              {winnerName}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Спосіб перемоги</p>
          <select
            value={winMethod}
            onChange={(e) => onWinMethodChange(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-white rounded p-2 text-sm focus:outline-none"
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Скасувати</Button>
          <Button disabled={busy} className="bg-blue-600 hover:bg-blue-700" onClick={onConfirm}>
            Підтвердити
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
