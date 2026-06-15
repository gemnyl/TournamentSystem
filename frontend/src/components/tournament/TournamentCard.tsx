import { Link } from "react-router-dom";
import { MapPin, Calendar, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import type { Tournament } from "@/types/api";

import { formatSportType } from "@/lib/utils";

interface TournamentCardProps {
  tournament: Tournament;
}

export function TournamentCard({ tournament }: TournamentCardProps) {
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleDateString("uk-UA", {
        day: "numeric", month: "short", year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const isRegClosed = tournament.status === "registration" &&
    tournament.registration_end &&
    new Date() > new Date(tournament.registration_end);

  const displayStatus = isRegClosed ? "registration_closed" : tournament.status;

  return (
    <Link to={`/tournaments/${tournament.id}`} className="block group">
      <Card className="transition-all duration-200 hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5 group-hover:bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-lg leading-tight group-hover:text-amber-500 transition-colors">
              {tournament.title}
            </CardTitle>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={displayStatus} type="tournament" />
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-amber-500 transition-colors" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {tournament.location && (
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>{tournament.location}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>{formatDate(tournament.start_date)} — {formatDate(tournament.end_date)}</span>
            </div>
          </div>
          {tournament.sport_type && (
            <p className="text-xs text-muted-foreground/70 mt-3 line-clamp-2">
              {formatSportType(tournament.sport_type)}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
