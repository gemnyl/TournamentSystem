import React from "react";
import { Button } from "@/components/ui/button";

interface TimeAdjustmentInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  onAdjust: (sign: number) => void;
}

export const TimeAdjustmentInput: React.FC<TimeAdjustmentInputProps> = ({
  inputRef,
  disabled,
  onAdjust,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onAdjust(1);
    }
  };

  return (
    <div className="flex gap-1 items-center w-full mt-1">
      <input
        type="number"
        placeholder="± сек"
        ref={inputRef}
        disabled={disabled}
        className="w-full h-6 text-[10px] px-1 border border-zinc-800 rounded bg-zinc-950 text-white text-center font-mono focus:outline-none"
        onKeyDown={handleKeyDown}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-6 w-8 text-xs font-bold"
        disabled={disabled}
        onClick={() => onAdjust(1)}
      >
        +
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-6 w-8 text-xs font-bold"
        disabled={disabled}
        onClick={() => onAdjust(-1)}
      >
        -
      </Button>
    </div>
  );
};
