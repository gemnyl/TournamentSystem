import { Link } from "react-router-dom";
import { Users, Weight, ChevronRight, GitBranch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import type { Category } from "@/types/api";
import { cn } from "@/lib/utils";

interface CategoryCardProps {
  category: Category;
  estimate?: {
    startTime: number;
    tatamiNumber: number | null;
    isLive: boolean;
    isTatamiActive: boolean;
  };
}

export function CategoryCard({ category, estimate }: Readonly<CategoryCardProps>) {
  // Форматуємо час початку
  const timeStr = estimate
    ? new Date(estimate.startTime).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  let estimateBadge: React.ReactNode = null;
  if (estimate) {
    if (estimate.isTatamiActive) {
      if (estimate.isLive) {
        estimateBadge = (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 animate-pulse">
            <span className="w-1 h-1 rounded-full bg-green-400 shrink-0" />
            Live (Татамі №{estimate.tatamiNumber})
          </span>
        );
      } else {
        estimateBadge = (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
            ⏱️ ~{timeStr} {estimate.tatamiNumber ? `(Татамі №${estimate.tatamiNumber})` : ""}
          </span>
        );
      }
    } else {
      estimateBadge = (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20">
          ⏱️ Призупинено {estimate.tatamiNumber ? `(Татамі №${estimate.tatamiNumber})` : ""}
        </span>
      );
    }
  }

  let weightStr = "без обмежень";
  if (category.min_weight !== null && category.max_weight !== null) {
    weightStr = `${category.min_weight}–${category.max_weight} кг`;
  } else if (category.min_weight !== null) {
    weightStr = `від ${category.min_weight} кг`;
  } else if (category.max_weight !== null) {
    weightStr = `до ${category.max_weight} кг`;
  }

  return (
    <Link to={`/categories/${category.id}`} className="block group">
      <Card className={cn(
        "transition-all duration-200 hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5",
        estimate?.isLive && "border-green-500/30 bg-green-500/5 hover:border-green-500/50"
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base leading-tight group-hover:text-amber-500 transition-colors">
              {category.name}
            </CardTitle>
            <div className="flex items-center gap-2 shrink-0">
              {estimateBadge}
              {!category.has_bracket && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">
                  Сітка не згенерована
                </span>
              )}
              <StatusBadge status={category.status} type="category" />
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-amber-500 transition-colors" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {category.allowed_gender_display}
            </span>
            <span className="flex items-center gap-1">
              <Weight className="w-3 h-3" />
              {weightStr}
            </span>
            <span>
              {category.min_age}–{category.max_age} р.
            </span>
            <span className="flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              {category.bracket_format_display}
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {category.confirmed_registrations_count} учасників
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
