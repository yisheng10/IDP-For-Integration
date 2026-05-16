create or replace view public.gemini_key_registry_kl_view as
select
  id,
  label,
  owner_name,
  owner_contact,
  status,
  disabled_reason,
  last_error_code,
  last_error_message,
  failure_count,
  last_used_at,
  last_failed_at,
  unavailable_until,
  created_at,
  updated_at,
  case
    when last_used_at is null then null
    else to_char(timezone('Asia/Kuala_Lumpur', last_used_at), 'DD/MM/YYYY, HH12:MI:SS AM')
  end as last_used_at_kl_12h,
  case
    when last_failed_at is null then null
    else to_char(timezone('Asia/Kuala_Lumpur', last_failed_at), 'DD/MM/YYYY, HH12:MI:SS AM')
  end as last_failed_at_kl_12h,
  case
    when unavailable_until is null then null
    else to_char(timezone('Asia/Kuala_Lumpur', unavailable_until), 'DD/MM/YYYY, HH12:MI:SS AM')
  end as unavailable_until_kl_12h,
  to_char(timezone('Asia/Kuala_Lumpur', created_at), 'DD/MM/YYYY, HH12:MI:SS AM') as created_at_kl_12h,
  to_char(timezone('Asia/Kuala_Lumpur', updated_at), 'DD/MM/YYYY, HH12:MI:SS AM') as updated_at_kl_12h
from public.gemini_key_registry;
