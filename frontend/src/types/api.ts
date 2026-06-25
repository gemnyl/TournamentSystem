// ─── Користувач та аутентифікація ───────────────────────────────────────────

export type UserRole = "organizer" | "coach" | "judge" | "spectator" | "admin" | "staff";

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  patronymic?: string;
  role: UserRole;
  club?: { id: number; name: string; region: string } | null;
  photo?: string | null;
  phone?: string;
  birth_date?: string;
  gender?: "male" | "female";
  skill_level?: string;
  referee_category?: string;
  email_verified?: boolean;
  date_joined?: string;
  name_locked?: boolean;
  is_club_leader?: boolean;
  credit_limit?: number;
}

export interface RoleRequest {
  id: number;
  user: User;
  requested_role: UserRole;
  club_id?: number | null;
  club_name?: string;
  club?: Club | null;
  referee_category?: string;
  status: "pending" | "approved" | "rejected";
  details?: string;
  document?: string | null;
  photo_with_id?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by?: User | null;
  review_notes?: string;
}

// ─── Клуб ───────────────────────────────────────────────────────────────────

export interface Club {
  id: number;
  name: string;
  region: string;
}

// ─── Команда ─────────────────────────────────────────────────────────────────

export interface Team {
  id: number;
  name: string;
  club?: Club | null;
  coach?: User | null;
  athletes: Athlete[];
  created_at: string;
}

// ─── Атлет ──────────────────────────────────────────────────────────────────

export interface Athlete {
  id: number;
  first_name: string;
  last_name: string;
  patronymic?: string;
  /** Повне ім'я: зручне поле для відображення */
  full_name?: string;
  birth_date: string; // ISO date
  gender: "male" | "female";
  base_weight: number;       // кг, float
  club?: { id: number; name: string; region: string } | null;
  club_id?: number;
  skill_level: string;
  photo?: string | null;
  coach?: User | null;
  qr_token?: string;
}

// ─── Турнір ─────────────────────────────────────────────────────────────────

export type TournamentStatus = "draft" | "registration" | "active" | "completed";

export interface Tournament {
  id: number;
  title: string;        // бекенд повертає "title", не "name"
  sport_type: string;   // бекенд повертає "sport_type", не "description"
  description?: string | null;
  location: string;
  start_date: string;   // ISO datetime з timezone
  end_date: string;
  status: TournamentStatus;
  status_display: string;
  organizer: number;
  organizer_name: string;
  weigh_in_required: boolean;
  registration_start: string | null;
  registration_end: string | null;
  completed_at: string | null;
  created_at: string;
  online_payment_enabled?: boolean;
  payment_details?: string;
  base_registration_fee?: number;
  base_team_registration_fee?: number | null;
  ruleset_prices?: Record<string, number>;
  ruleset_team_prices?: Record<string, number>;
  commission_payer?: "buyer" | "organizer";

  platform_fee_status?: "paid" | "unpaid";
  platform_fee_amount?: number;
  staff_members?: number[];
  judges?: number[];
  chief_judge?: number | null;
  chief_judge_name?: string | null;
  use_check_in?: boolean;
  categories?: Category[];
}

// ─── Категорія ──────────────────────────────────────────────────────────────

export type BracketFormat = "single_elimination" | "double_elimination" | "round_robin" | "single_repechage" | "swiss";
export type DoubleElimType = "full" | "short";
export type CategoryStatus = TournamentStatus;

export interface Category {
  id: number;
  tournament: number;
  name: string;
  allowed_gender: "male" | "female" | "mixed";
  allowed_gender_display: string;
  min_age: number;
  max_age: number;
  min_weight: number | null;
  max_weight: number | null;
  allowed_skill_level: string;
  ruleset_key: string;
  match_duration_seconds: number;
  bracket_format: BracketFormat;
  bracket_format_display: string;
  double_elim_type?: DoubleElimType | null;
  status: CategoryStatus;
  confirmed_registrations_count: number;
  has_bracket: boolean;
  schedule_order: number;
  two_third_places?: boolean;
  results_finalized?: boolean;
  judges_count?: number | null;
  is_team: boolean;
  team_size: number;
  registration_fee: number | null;
  athlete_fee: number;
}

// ─── Реєстрація ─────────────────────────────────────────────────────────────

export type RegistrationStatus = "pending" | "confirmed" | "withdrawn";

export interface Registration {
  id: number;
  category: number;
  category_name: string;
  tournament_id?: number;
  tournament_title?: string;
  fee?: number;
  commission_payer?: "buyer" | "organizer";
  athlete: Athlete | null;
  recorded_weight: number | null;
  status: RegistrationStatus;
  status_display: string;
  seed_number: number | null;
  place?: number | null;
  created_at: string;
  team: Team | null;
  payment_status: "unpaid" | "paid";
  payment_method?: "online" | "offline";
  checked_in: boolean;
  coach_name_short?: string;
  online_payment_enabled?: boolean;
  payment_details?: string;
  refund_policy?: "refundable" | "non_refundable";
  offline_refund_status?: "none" | "pending" | "confirmed";
  qr_token?: string;
  tournament_status?: string;
  payment_invoice?: Invoice;
}

export interface RegistrationDetail {
  id: number;
  athlete_name: string;
  category_name: string;
}

export interface Invoice {
  id: number;
  invoice_id?: string;
  payment_type: string;
  payment_type_display?: string;
  amount: number;
  status: string;
  status_display?: string;
  payment_url?: string;
  created_at: string;
  registration_details?: RegistrationDetail[];
}

// ─── Матч ───────────────────────────────────────────────────────────────────

export type MatchStatus = "scheduled" | "ongoing" | "completed";
export type WinMethod = "decision" | "disqualification" | "walkover" | "withdrawal" | "points" | "hantei" | "hansoku" | "kiken" | "ippon" | "wazaari" | "draw";
export type TimerStatus = "not_started" | "running" | "paused" | "finished";

export interface Match {
  id: number;
  category: number;
  round_index: number;
  match_order: number;
  tatami: number | null;
  reg_first: Registration | null;   // null = BYE
  reg_second: Registration | null;  // null = BYE
  score_first: number;
  score_second: number;
  warnings_first: number;
  warnings_second: number;
  senshu: "none" | "aka" | "ao";
  status: MatchStatus;
  winner: number | null;            // Registration id
  win_method: WinMethod | null;
  win_method_display?: string | null;
  next_match: number | null;        // Match id куди йде переможець
  started_at: string | null;
  completed_at: string | null;
  timer_status: TimerStatus;
  timer_started_at: string | null;  // ISO datetime
  timer_elapsed_ms: number;
  timer_duration_ms: number;
  ruleset_key: string;
  category_name?: string;
  category_order?: number;
  judging_mode: "points" | "flags";
  judges_count?: number | null;
  flags_aka?: number | null;
  flags_ao?: number | null;
  show_timer: boolean;
  parent_team_match?: number | null;
  athlete_first?: Athlete | null;
  athlete_second?: Athlete | null;
  bout_index?: number | null;
  category_is_team?: boolean;
  team_bouts?: Match[];
  is_team_bouts_supported?: boolean;
  tournament_id?: number;
  tournament_title?: string;
  is_bracket_reset?: boolean;
  redirect_to_match_id?: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  match_state?: TaekwondoMatchState | JudoMatchState | any;
}

export interface TaekwondoRoundHistoryEntry {
  round: number;
  scores: { chung: number; hong: number };
  gam_jeoms: { chung: number; hong: number };
  winner: "chung" | "hong" | null;
  win_method?: string;
}

export interface TaekwondoMatchState {
  current_round: number;
  rounds_won: { chung: number; hong: number };
  scores: { chung: number; hong: number };
  gam_jeoms: { chung: number; hong: number };
  round_history: TaekwondoRoundHistoryEntry[];
}

export interface JudoMatchState {
  scores: {
    shiro: { waza_ari: number; ippon: number };
    ao: { waza_ari: number; ippon: number };
  };
  penalties: {
    shiro: { shido: number; hansoku_make: boolean };
    ao: { shido: number; hansoku_make: boolean };
  };
  is_golden_score: boolean;
  osaekomi: {
    active_for: "shiro" | "ao" | null;
    start_timestamp: number | null;
  };
}

// ─── Рулсет ─────────────────────────────────────────────────────────────────

export interface ScoreAction {
  key: string;
  label: string;
  points: number;
  is_warning: boolean;
}

export interface WinMethodInfo {
  key: string;
  label: string;
}

export interface RulesetInfo {
  key: string;
  name: string;
  sport_type: string;
  judging_mode: "points" | "flags";
  default_duration_seconds?: number | null;
  score_actions: ScoreAction[];
  win_methods: WinMethodInfo[];
}

// ─── Татамі ──────────────────────────────────────────────────────────────────

export interface Tatami {
  id: number;
  tournament: number;
  number: number;
  name: string;
  current_match: number | null;
  assigned_judge: number | null;
  assigned_judge_name?: string;
  is_active: boolean;
  matches_count?: number;
  upcoming_matches?: Match[];
  active_results_category?: number | null;
  active_results_category_name?: string | null;
  // Annotated fields from list endpoints
  tournament_title?: string;
  tournament_status?: string;
}

export interface TatamiSnapshot {
  tatami: Tatami;
  server_ts_ms: number;
  current_match: Match | null;
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
  patronymic?: string;
  role: UserRole;
  club_id?: number | null;
  phone?: string;
  birth_date?: string;
  gender?: "male" | "female";
  skill_level?: string;
  referee_category?: string;
  details?: string;
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
  min_weight: number | null;
  max_weight: number | null;
  bracket_format: BracketFormat;
}

// Legacy UpdateScoreData та SetWinnerData видалено

// ─── Пагінація DRF ──────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface MatchEvent {
  id: number;
  match: number;
  sequence: number;
  event_type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  judge: number | null;
  judge_name: string | null;
  created_at: string;
}

export interface CategoryResult {
  place: number | null;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scores_scored: number;
  scores_conceded: number;
  name?: string;
  club?: string;
  registration: {
    id: number;
    place?: number | null;
    athlete?: {
      full_name: string;
      club?: { name?: string; region?: string } | null;
    } | null;
    team?: {
      name: string;
      club?: { name?: string; region?: string } | null;
      athletes?: { last_name: string }[] | null;
    } | null;
  };
}
