// ─── Користувач та аутентифікація ───────────────────────────────────────────

export type UserRole = "organizer" | "coach" | "judge" | "spectator";

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  club?: { id: number; name: string; region: string } | null;
}

// ─── Клуб ───────────────────────────────────────────────────────────────────

export interface Club {
  id: number;
  name: string;
  city: string;
  country: string;
}

// ─── Атлет ──────────────────────────────────────────────────────────────────

export interface Athlete {
  id: number;
  first_name: string;
  last_name: string;
  /** Повне ім'я: зручне поле для відображення */
  full_name?: string;
  birth_date: string; // ISO date
  gender: "male" | "female";
  base_weight: number;       // кг, float
  club?: { id: number; name: string; city: string; country: string };
  club_id?: number;
}

// ─── Турнір ─────────────────────────────────────────────────────────────────

export type TournamentStatus = "draft" | "registration" | "ongoing" | "completed" | "cancelled";

export interface Tournament {
  id: number;
  title: string;        // бекенд повертає "title", не "name"
  sport_type: string;   // бекенд повертає "sport_type", не "description"
  location: string;
  start_date: string;   // ISO datetime з timezone
  end_date: string;
  status: TournamentStatus;
  status_display: string;
  organizer: number;
  organizer_name: string;
  created_at: string;
}

// ─── Категорія ──────────────────────────────────────────────────────────────

export type BracketFormat = "single_elimination" | "double_elimination" | "round_robin";
export type CategoryStatus = "draft" | "registration" | "ongoing" | "completed";

export interface Category {
  id: number;
  tournament: number;
  name: string;
  allowed_gender: "male" | "female" | "mixed";
  allowed_gender_display: string;
  min_age: number;
  max_age: number;
  min_weight: number;
  max_weight: number;
  bracket_format: BracketFormat;
  bracket_format_display: string;
  status: CategoryStatus;
  confirmed_registrations_count: number;
}

// ─── Реєстрація ─────────────────────────────────────────────────────────────

export type RegistrationStatus = "pending" | "confirmed" | "withdrawn";

export interface Registration {
  id: number;
  category: number;
  category_name: string;
  athlete: Athlete;
  recorded_weight: number | null;
  status: RegistrationStatus;
  status_display: string;
  seed_number: number | null;
  created_at: string;
}

// ─── Матч ───────────────────────────────────────────────────────────────────

export type MatchStatus = "scheduled" | "ongoing" | "completed" | "bye";
export type WinMethod = "points" | "ippon" | "waza_ari" | "disqualification" | "withdrawal" | "bye";

export interface Match {
  id: number;
  category: number;
  round_index: number;
  match_order: number;
  reg_first: Registration | null;   // null = BYE
  reg_second: Registration | null;  // null = BYE
  score_first: number;
  score_second: number;
  warnings_first: number;
  warnings_second: number;
  status: MatchStatus;
  winner: number | null;            // Registration id
  win_method: WinMethod | null;
  next_match: number | null;        // Match id куди йде переможець
  started_at: string | null;
  completed_at: string | null;
}

// ─── Сітка ──────────────────────────────────────────────────────────────────

export interface BracketResponse {
  format: BracketFormat;
  /**
   * Масив раундів; кожен раунд — масив матчів.
   * rounds[0] = 1/4 (або 1/8), rounds[last] = фінал.
   */
  rounds: Match[][];
}

// ─── Допоміжні типи для форм ─────────────────────────────────────────────────

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  password_confirm: string;
  first_name: string;
  last_name: string;
}

export interface CreateTournamentData {
  title: string;
  sport_type: string;
  location: string;
  start_date: string;
  end_date: string;
}

export interface CreateCategoryData {
  tournament: number;
  name: string;
  allowed_gender: "male" | "female" | "mixed";
  min_age: number;
  max_age: number;
  min_weight: number;
  max_weight: number;
  bracket_format: BracketFormat;
}

export interface UpdateScoreData {
  participant: 1 | 2;
  delta: number;
}

export interface SetWinnerData {
  winner_id: number;
  method: WinMethod;
}

// ─── Пагінація DRF ──────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}