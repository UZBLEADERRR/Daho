export interface CloudPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  period: 'monthly' | 'yearly' | 'once' | 'free';
  credit_grant: number;
  daily_credit_cap: number | null;
  allow_background: boolean;
  max_queued_jobs: number;
  max_jobs_per_day: number;
  features: Record<string, unknown>;
  is_active?: boolean;
  is_default?: boolean;
  sort?: number;
}

export interface PlanModel {
  id?: string;
  plan_id?: string;
  model: string;
  role: 'chat' | 'image' | 'tts' | 'video' | 'other';
  input_price: number;
  output_price: number;
  call_price: number;
}

/** `my_account()` RPC javobi. */
export interface Account {
  signed_in: boolean;
  user_id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  blocked: boolean;
  plan: CloudPlan | null;
  subscription: { status: string; started_at: string; expires_at: string | null } | null;
  balance: number;
  granted: number;
  used: number;
  period_end: string | null;
  models: PlanModel[];
  usage_today: number;
  usage_month: number;
  active_jobs: number;
}

export interface CloudJob {
  id: string;
  user_id: string;
  kind: 'chat' | 'search' | 'json' | 'image' | 'plan';
  title: string;
  payload: Record<string, unknown>;
  model: string | null;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  result: Record<string, unknown> | null;
  error: string | null;
  credits: number;
  created_at: string;
  finished_at: string | null;
}

export interface UsageRow {
  id: number;
  model: string;
  kind: string;
  source: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  credits: number;
  created_at: string;
}
