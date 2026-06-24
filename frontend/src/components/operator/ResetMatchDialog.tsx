import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ResetMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
}

export const ResetMatchDialog: React.FC<ResetMatchDialogProps> = ({
  open,
  onOpenChange,
  busy,
  onConfirm,
  children,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 text-white border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-red-500 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> Скинути та переграти поєдинок
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm text-zinc-400 space-y-2">
          <p>Ви впевнені, що хочете повністю скинути стан поєдинку?</p>
          <p className="font-semibold text-zinc-200">Це призведе до:</p>
          <ul className="list-disc pl-5 space-y-1">
            {children}
            <li>Повернення поєдинку до статусу "Заплановано"</li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Скасувати</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            Скинути та почати заново
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
