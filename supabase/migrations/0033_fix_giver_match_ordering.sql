-- ===========================================================================
-- Harvesters Finance OS — 0033 Fix: exact giver matches were buried
--
-- find_giver_matches computed is_exact as `(phone check) or (email check)`,
-- which is NULL (not false) for givers with no phone/email on file. Combined
-- with `order by is_exact desc` — where DESC places NULLs FIRST — every
-- null-is_exact fuzzy row outranked genuine exact matches, and with a LIMIT
-- the exact match often never surfaced at all. Net effect: the unique-giver
-- resolution engine silently degraded to "always create a new giver" once
-- the giver base grew. (Found by the Phase 2 online-giving test.)
--
-- Fix: coalesce is_exact to false and sort NULLS LAST for safety.
-- ===========================================================================

create or replace function public.find_giver_matches(
  p_name text, p_phone text, p_email text, p_limit int default 5
) returns table (giver_id uuid, full_name text, score real, reason text, is_exact boolean)
language sql stable security definer set search_path = '' as $$
  with n as (
    select public.normalize_phone(p_phone) as phk,
           public.normalize_email(p_email)  as em,
           nullif(trim(coalesce(p_name, '')), '') as nm
  )
  select g.id, g.full_name,
    greatest(
      coalesce(case when n.phk is not null
                    then extensions.similarity(coalesce(public.normalize_phone(g.phone), ''), n.phk) end, 0),
      coalesce(case when n.em is not null
                    then extensions.similarity(coalesce(public.normalize_email(g.email), ''), n.em) end, 0),
      coalesce(case when n.nm is not null
                    then extensions.similarity(g.full_name, n.nm) end, 0)
    )::real as score,
    case
      when n.phk is not null and public.normalize_phone(g.phone) = n.phk then 'phone'
      when n.em  is not null and public.normalize_email(g.email) = n.em  then 'email'
      else 'name/near'
    end as reason,
    coalesce(
      (n.phk is not null and public.normalize_phone(g.phone) = n.phk)
      or (n.em is not null and public.normalize_email(g.email) = n.em),
      false) as is_exact
  from public.givers g, n
  where g.is_active
    and (n.phk is not null or n.em is not null or n.nm is not null)
  order by is_exact desc nulls last, score desc
  limit p_limit;
$$;
grant execute on function public.find_giver_matches(text, text, text, int) to authenticated, service_role;
