import { Link } from "react-router-dom";
import { Users, Weight, ChevronRight, GitBranch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import type { Category } from "@/types/api";

// Remove unused labels

interface CategoryCardProps {
  category: Category;
}

export function CategoryCard({ category }: CategoryCardProps) {
  return (
    <Link to={`/categories/${category.id}`} className="block group">
      <Card className="transition-all duration-200 hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base leading-tight group-hover:text-amber-500 transition-colors">
              {category.name}
            </CardTitle>
            <div className="flex items-center gap-2 shrink-0">
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
              {category.min_weight}–{category.max_weight} кг
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
