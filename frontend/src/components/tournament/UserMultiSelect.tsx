import { useState, useEffect } from "react";
import { Search, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import api from "@/lib/api";

interface UserProfile {
  id: number;
  first_name: string;
  last_name: string;
  patronymic?: string;
  email: string;
}

interface UserMultiSelectProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  selectedProfiles: UserProfile[];
  onAddProfile: (profile: UserProfile) => void;
  role: string; // e.g. "judge" or "staff,judge"
  searchLabel: string;
  placeholder: string;
  emptyLabel?: string;
}

export function UserMultiSelect({
  selectedIds,
  onChange,
  selectedProfiles,
  onAddProfile,
  role,
  searchLabel,
  placeholder,
  emptyLabel = "Користувачів не призначено",
}: Readonly<UserMultiSelectProps>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(
          `/auth/users/?role=${role}&search=${encodeURIComponent(searchQuery)}`
        );
        const list = Array.isArray(res.data) ? res.data : res.data?.results || [];
        setSearchResults(list);
      } catch (e) {
        console.error("Failed to search users", e);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, role]);

  const handleRemove = (id: number) => {
    onChange(selectedIds.filter((x) => x !== id));
  };

  return (
    <div className="space-y-3">
      {/* Selected Items Badges */}
      <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 rounded-xl border border-dashed border-border/80 bg-muted/10">
        {selectedIds.length === 0 ? (
          <span className="text-xs text-muted-foreground self-center">{emptyLabel}</span>
        ) : (
          selectedIds.map((id) => {
            const profile = selectedProfiles.find((u) => u.id === id);
            const label = profile
              ? `${profile.last_name} ${profile.first_name[0]}. (${profile.email})`
              : `Користувач #${id}`;
            return (
              <Badge
                key={id}
                variant="secondary"
                className="gap-1 px-2.5 py-1 text-xs rounded-lg border border-border/60"
              >
                {label}
                <button
                  type="button"
                  onClick={() => handleRemove(id)}
                  className="hover:text-destructive text-muted-foreground font-bold shrink-0 ml-0.5"
                >
                  ✕
                </button>
              </Badge>
            );
          })
        )}
      </div>

      {/* Search Input & Dropdown */}
      <div className="relative space-y-1.5">
        <Label className="text-xs text-muted-foreground">{searchLabel}</Label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={placeholder}
            className="pl-9 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searching && (
            <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {searchQuery.trim() && (
          <div className="absolute z-50 w-full mt-1 border border-border bg-card shadow-lg rounded-xl max-h-48 overflow-y-auto divide-y divide-border/30">
            {searchResults.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">Нічого не знайдено</p>
            ) : (
              searchResults.map((u) => {
                const isAlreadySelected = selectedIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={isAlreadySelected}
                    onClick={() => {
                      onChange([...selectedIds, u.id]);
                      onAddProfile(u);
                      setSearchQuery("");
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-muted/50 transition-colors",
                      isAlreadySelected && "opacity-50 cursor-default bg-muted/20"
                    )}
                  >
                    <div>
                      <span className="font-bold text-foreground">
                        {u.last_name} {u.first_name} {u.patronymic || ""}
                      </span>
                      <span className="text-[10px] text-muted-foreground block">{u.email}</span>
                    </div>
                    {isAlreadySelected ? (
                      <span className="text-[10px] text-amber-500 font-semibold">Вже додано</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground font-semibold hover:text-amber-500">
                        + Додати
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
