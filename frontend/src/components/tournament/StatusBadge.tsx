import { Badge } from "@/components/ui/badge";
import type { TournamentStatus, CategoryStatus, MatchStatus, RegistrationStatus } from "@/types/api";

const TOURNAMENT_LABELS: Record<TournamentStatus | "registration_closed", string> = {
  draft:        "Чернетка",
  registration: "Реєстрація",
  registration_closed: "Реєстрацію закрито",
  active:       "Триває",
  completed:    "Завершено",
};

const CATEGORY_LABELS: Record<CategoryStatus, string> = {
  draft:        "Чернетка",
  registration: "Реєстрація",
  active:       "Триває",
  completed:    "Завершено",
};

const MATCH_LABELS: Record<MatchStatus, string> = {
  scheduled: "Заплановано",
  ongoing:   "Йде",
  completed: "Завершено",
};

const REGISTRATION_LABELS: Record<RegistrationStatus, string> = {
  pending:   "Очікує",
  confirmed: "Підтверджено",
  withdrawn: "Знято",
};

type StatusBadgeVariant = TournamentStatus | CategoryStatus | MatchStatus | RegistrationStatus | "registration_closed";

const VARIANT_MAP: Record<string, "draft" | "registration" | "ongoing" | "completed" | "cancelled" | "secondary" | "destructive" | "outline"> = {
  draft:        "draft",
  registration: "registration",
  registration_closed: "secondary",
  active:       "ongoing",
  ongoing:      "ongoing",
  completed:    "completed",
  scheduled:    "secondary",
  pending:      "secondary",
  confirmed:    "completed",
  withdrawn:    "cancelled",
};

interface StatusBadgeProps {
  status: StatusBadgeVariant;
  type?: "tournament" | "category" | "match" | "registration";
  className?: string;
}

export function StatusBadge({ status, type = "tournament", className }: StatusBadgeProps) {
  const label =
    type === "tournament" ? TOURNAMENT_LABELS[status as TournamentStatus] :
    type === "category"   ? CATEGORY_LABELS[status as CategoryStatus] :
    type === "match"      ? MATCH_LABELS[status as MatchStatus] :
    REGISTRATION_LABELS[status as RegistrationStatus];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const variant = (VARIANT_MAP[status] ?? "secondary") as any;

  return <Badge variant={variant} className={className}>{label ?? status}</Badge>;
}
