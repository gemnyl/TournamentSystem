import React from "react";

interface TimePresetSelectProps {
  disabled?: boolean;
  onSelectDuration: (durationSec: number) => void;
}

export const TimePresetSelect: React.FC<TimePresetSelectProps> = ({
  disabled,
  onSelectDuration,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = Number.parseInt(e.target.value, 10);
    if (val > 0) {
      onSelectDuration(val);
    }
  };

  return (
    <select
      disabled={disabled}
      onChange={handleChange}
      defaultValue=""
      className="w-full h-6 text-[10px] px-1 border border-zinc-800 rounded bg-zinc-950 text-white mt-1 cursor-pointer focus:outline-none"
    >
      <option value="" disabled>Оберіть час...</option>
      <option value="90">1:30</option>
      <option value="120">2:00</option>
      <option value="180">3:00</option>
      <option value="240">4:00</option>
    </select>
  );
};
