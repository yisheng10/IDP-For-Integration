create table if not exists public.dropout_shadow_predictions (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text not null,
  subject_id text,
  dropout_subject_id text not null,
  trial_id text,
  scored_at timestamptz not null,
  published_at timestamptz not null default timezone('utc', now()),
  as_of_day_index integer,
  dropout_probability double precision not null,
  risk_bucket text not null,
  is_actionable boolean not null default false,
  recommended_action text,
  action_priority_score double precision,
  model_version text,
  model_line text,
  official_split_strategy text,
  selection_policy text,
  source_mode text not null default 'live',
  subject_mapping_source text,
  data_quality_flags jsonb not null default '[]'::jsonb,
  missing_inputs_summary jsonb not null default '[]'::jsonb,
  explanation_signals jsonb not null default '[]'::jsonb,
  patient_static_context_ready boolean,
  protocol_static_context_ready boolean,
  source_coverage jsonb not null default '{}'::jsonb,
  source_system text not null default 'triallight-dropout-precompute',
  proxy_eval_status text not null default 'pending',
  proxy_eval_due_at timestamptz,
  proxy_eval_attempted_at timestamptz,
  proxy_eval_completed_at timestamptz,
  proxy_eval_version text,
  proxy_summary jsonb not null default '{}'::jsonb
);

comment on table public.dropout_shadow_predictions is
  'Shadow-monitoring snapshots for fully-live TrialLight dropout scoring, including future proxy evaluation status.';

create index if not exists idx_dropout_shadow_predictions_due_status
  on public.dropout_shadow_predictions (proxy_eval_status, proxy_eval_due_at asc);

create index if not exists idx_dropout_shadow_predictions_firebase_uid_published_at
  on public.dropout_shadow_predictions (firebase_uid, published_at desc);

create index if not exists idx_dropout_shadow_predictions_subject_scored_at
  on public.dropout_shadow_predictions (dropout_subject_id, scored_at desc);

create table if not exists public.dropout_proxy_evaluations (
  id uuid primary key default gen_random_uuid(),
  shadow_prediction_id uuid unique references public.dropout_shadow_predictions(id),
  firebase_uid text not null,
  subject_id text,
  trial_id text,
  scored_at timestamptz not null,
  as_of_day_index integer,
  evaluated_at timestamptz not null default timezone('utc', now()),
  evaluation_window_days integer not null default 7 check (evaluation_window_days >= 1),
  proxy_version text not null,
  proxy_outcomes jsonb not null default '{}'::jsonb,
  proxy_summary jsonb not null default '{}'::jsonb
);

comment on table public.dropout_proxy_evaluations is
  'Forward-looking proxy outcome evaluations linked to shadow dropout predictions.';

create index if not exists idx_dropout_proxy_evaluations_subject_evaluated_at
  on public.dropout_proxy_evaluations (subject_id, evaluated_at desc);
