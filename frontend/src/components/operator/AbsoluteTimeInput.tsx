import React from "react";
import { Button } from "@/components/ui/button";

interface AbsoluteTimeInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  onSetDuration: (durationSec: number) => void;
}

export const AbsoluteTimeInput: React.FC<AbsoluteTimeInputProps> = ({
  inputRef,
  disabled,
  onSetDuration,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const val = Number.parseInt((e.target as HTMLInputElement).value || "0");
      if (val > 0) {
        onSetDuration(val);
        (e.target as HTMLInputElement).value = "";
      }
    }
  };

  const handleClick = () => {
    const val = Number.parseInt(inputRef.current?.value || "0");
    if (val > 0) {
      onSetDuration(val);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div className="flex gap-1 items-center w-full mt-1">
      <input
        type="number"
        placeholder="Задати сек"
        ref={inputRef}
        disabled={disabled}
        className="w-full h-6 text-[10px] px-1 border border-zinc-800 rounded bg-zinc-950 text-white text-center font-mono focus:outline-none"
        onKeyDown={handleKeyDown}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-1.5 text-[9px] font-bold"
        disabled={disabled}
        onClick={handleClick}
      >
        Задати
      </Button>
    </div>
  );
};
