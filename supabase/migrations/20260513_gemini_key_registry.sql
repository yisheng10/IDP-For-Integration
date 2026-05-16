create table if not exists public.gemini_key_registry (
  id bigint generated always as identity primary key,
  label text not null unique,
  owner_name text null,
  owner_contact text null,
  api_key text not null unique,
  status text not null default 'active' check (status in ('active', 'reached_limit', 'disabled')),
  disabled_reason text null check (
    disabled_reason is null or disabled_reason in ('leaked', 'invalid', 'permission_denied', 'manual')
  ),
  last_error_code text null,
  last_error_message text null,
  failure_count integer not null default 0,
  last_used_at timestamptz null,
  last_failed_at timestamptz null,
  unavailable_until timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists gemini_key_registry_status_idx
  on public.gemini_key_registry (status, unavailable_until);

create or replace function public.set_gemini_key_registry_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists gemini_key_registry_set_updated_at on public.gemini_key_registry;
create trigger gemini_key_registry_set_updated_at
before update on public.gemini_key_registry
for each row
execute function public.set_gemini_key_registry_updated_at();

alter table public.gemini_key_registry enable row level security;

revoke all on public.gemini_key_registry from anon;
revoke all on public.gemini_key_registry from authenticated;
