create table if not exists public.epro_trial_daily_review (
  id uuid primary key default gen_random_uuid(),
  review_date date not null,
  trial_id text not null,
  protocol_name text,
  baseline_questions jsonb not null default '[]'::jsonb,
  effective_questions jsonb not null default '[]'::jsonb,
  wording_overrides jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending_crc_review',
  review_cutoff_at timestamptz,
  patient_visible_at timestamptz,
  patient_due_at timestamptz,
  active_patient_count integer not null default 0,
  approved_at timestamptz,
  approved_by text,
  approved_by_name text,
  auto_released_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (review_date, trial_id)
);

create index if not exists idx_epro_trial_daily_review_date_status
  on public.epro_trial_daily_review (review_date, review_status);

create table if not exists public.epro_patient_daily_review (
  id uuid primary key default gen_random_uuid(),
  review_date date not null,
  trial_daily_review_id uuid not null references public.epro_trial_daily_review(id) on delete cascade,
  trial_id text not null,
  protocol_name text,
  firebase_uid text not null,
  subject_id text not null,
  patient_name text,
  day_number integer not null,
  form_id text not null,
  baseline_questions jsonb not null default '[]'::jsonb,
  customized_questions jsonb not null default '[]'::jsonb,
  effective_questions jsonb not null default '[]'::jsonb,
  review_scope text not null default 'patient_inherited',
  review_status text not null default 'pending_crc_review',
  wording_overrides jsonb not null default '{}'::jsonb,
  review_cutoff_at timestamptz,
  patient_visible_at timestamptz,
  patient_due_at timestamptz,
  assigned_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  approved_by_name text,
  auto_released_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (review_date, subject_id, day_number)
);

create index if not exists idx_epro_patient_daily_review_date_status
  on public.epro_patient_daily_review (review_date, review_status);

create index if not exists idx_epro_patient_daily_review_trial_scope
  on public.epro_patient_daily_review (trial_id, review_scope);
