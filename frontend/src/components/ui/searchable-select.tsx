import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  triggerClassName?: string;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Оберіть...",
  searchPlaceholder = "Пошук...",
  className,
  triggerClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Reset search when opening/closing
  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-slate-800 bg-slate-900/90 text-slate-200 px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-left",
          triggerClassName
        )}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-hidden rounded-md border border-slate-800 bg-slate-950 text-slate-200 shadow-md animate-in fade-in-0 zoom-in-95 duration-100 flex flex-col">
          <div className="flex items-center border-b border-slate-850 px-3 py-2 bg-slate-900/40 shrink-0">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              className="flex h-7 w-full bg-transparent py-2 text-xs outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 text-slate-200"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1 max-h-48 p-1">
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                Нічого не знайдено.
              </div>
            ) : (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onValueChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-xs outline-none hover:bg-slate-900 hover:text-white text-left",
                    opt.value === value && "bg-slate-900 text-white font-medium"
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.value === value && (
                    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
