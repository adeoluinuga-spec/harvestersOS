-- ===========================================================================
-- Harvesters Finance OS — 0025 Background jobs
--
-- The system must notice before the accountant does. This migration adds the
-- SQL-side nightly jobs and (where available) schedules them with pg_cron:
--   • escalate_stale_approvals — approval steps pending past the SLA raise
--     an in-app notification for the approver role at the entity and queue an
--     email per matched approver, at most once per 24h per step.
--   • notify_upcoming_maturities — investments maturing soon notify finance
--     roles, at most once per day per investment.
--   • run_nightly_jobs — one entry point that runs everything and reports
--     counts (also callable over HTTP via /api/jobs for hosts without cron).
-- Message delivery (email/WhatsApp) stays in the app tier: /api/jobs drains
-- public.message_outbox through the configured providers.
-- ===========================================================================

alter table public.requisition_approvals
  add column if not exists last_escalated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Approval SLA escalation (default: 3 days)
-- ---------------------------------------------------------------------------
create or replace function public.escalate_stale_approvals(p_sla_days int default 3)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  u record;
  v_entity uuid;
  v_title text;
  v_amount numeric;
  v_currency text;
  v_age int;
  v_count int := 0;
begin
  for r in
    select ra.id, ra.approver_role, ra.created_at,
           coalesce(rr.entity_id, rb.entity_id) as entity_id,
           coalesce(rr.description, 'Compiled batch') as description,
           coalesce(rr.amount, rb.total_amount) as amount,
           coalesce(rr.currency, rb.currency, 'NGN') as currency
    from public.requisition_approvals ra
    left join public.requisition_requests rr on rr.id = ra.requisition_request_id
    left join public.requisition_batches rb on rb.id = ra.requisition_batch_id
    where ra.status = 'pending'
      and ra.created_at < now() - make_interval(days => p_sla_days)
      and (ra.last_escalated_at is null or ra.last_escalated_at < now() - interval '24 hours')
      -- only the step actually blocking (all prior steps approved)
      and not exists (
        select 1 from public.requisition_approvals prev
        where prev.sequence_order < ra.sequence_order
          and prev.requisition_batch_id is not distinct from ra.requisition_batch_id
          and prev.requisition_request_id is not distinct from ra.requisition_request_id
          and prev.status <> 'approved')
  loop
    v_entity := r.entity_id;
    v_age := extract(day from now() - r.created_at)::int;
    v_title := 'Approval overdue: ' || left(r.description, 80);

    -- In-app: everyone holding the approver role for this entity scope.
    insert into public.notifications (user_id, role, entity_id, title, body, href)
    values (null, r.approver_role, v_entity, v_title,
            'A ' || replace(r.approver_role::text, '_', ' ') || ' approval for ' ||
            to_char(r.amount, 'FM999,999,999,990.00') || ' ' || r.currency ||
            ' has been waiting ' || v_age || ' days. SLA is ' || p_sla_days || ' days.',
            '/expenses/approvals');

    -- Email each matched approver (queued; the outbox drainer delivers).
    for u in
      with recursive up as (
        select id, parent_entity_id from public.entities where id = v_entity
        union all
        select e.id, e.parent_entity_id from public.entities e join up on e.id = up.parent_entity_id
      )
      select distinct au.id, au.email
      from public.user_entity_roles uer
      join auth.users au on au.id = uer.user_id
      where uer.role = r.approver_role
        and (uer.entity_id is null or uer.entity_id in (select id from up))
        and au.email is not null
    loop
      insert into public.message_outbox
        (channel, to_contact, to_user_id, subject, body, kind, entity_id, created_by)
      values
        ('email', u.email, u.id, v_title,
         'An approval assigned to your role has exceeded the ' || p_sla_days ||
         '-day SLA (waiting ' || v_age || ' days): ' || r.description ||
         ' — ' || to_char(r.amount, 'FM999,999,999,990.00') || ' ' || r.currency ||
         '. Open Expenses → Approvals to decide.', 'approval_sla', v_entity, null);
    end loop;

    update public.requisition_approvals set last_escalated_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Investment maturity notifications (default: within 14 days)
-- ---------------------------------------------------------------------------
create or replace function public.notify_upcoming_maturities(p_days int default 14)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_count int := 0; v_title text;
begin
  for r in
    select i.id, i.entity_id, e.name as entity_name, i.institution,
           i.principal_amount, i.currency, i.maturity_date,
           (i.maturity_date - current_date) as days_left
    from public.investments i
    join public.entities e on e.id = i.entity_id
    where i.status = 'active'
      and i.maturity_date between current_date and current_date + make_interval(days => p_days)
  loop
    v_title := 'Investment maturing in ' || r.days_left || ' day(s): ' || r.institution;
    -- Once per investment per day, per role.
    if exists (
      select 1 from public.notifications n
      where n.href = '/funds/investments' and n.title = v_title
        and n.entity_id = r.entity_id and n.created_at > now() - interval '24 hours'
    ) then continue; end if;

    insert into public.notifications (user_id, role, entity_id, title, body, href)
    select null, x.role, r.entity_id, v_title,
           r.entity_name || ': ' || to_char(r.principal_amount, 'FM999,999,999,990.00') || ' ' ||
           coalesce(r.currency, 'NGN') || ' principal matures ' || to_char(r.maturity_date, 'DD Mon YYYY') ||
           '. Decide rollover or redemption.', '/funds/investments'
    from (values ('group_finance_officer'::public.app_role), ('cfo_coo'::public.app_role)) as x(role);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Nightly entry point
-- ---------------------------------------------------------------------------
create or replace function public.run_nightly_jobs()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_esc int; v_mat int; v_lapse int := 0;
begin
  v_esc := public.escalate_stale_approvals(3);
  v_mat := public.notify_upcoming_maturities(14);
  begin
    perform public.refresh_investment_maturity_alerts(120);
    perform public.detect_lapsed_partners(current_date);
    get diagnostics v_lapse = row_count;
  exception when undefined_function then null; end;
  return jsonb_build_object(
    'escalated_approvals', v_esc,
    'maturity_notifications', v_mat,
    'ran_at', now());
end $$;

revoke all on function public.escalate_stale_approvals(int) from public, anon, authenticated;
revoke all on function public.notify_upcoming_maturities(int) from public, anon, authenticated;
revoke all on function public.run_nightly_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule with pg_cron where the platform allows it (02:15 UTC nightly).
-- The /api/jobs HTTP entry point covers hosts where pg_cron is unavailable
-- and also drains the message outbox (provider calls live in the app tier).
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not enabled here (%). Schedule /api/jobs externally.', sqlerrm;
    return;
  end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'hfos-nightly-jobs';
  perform cron.schedule('hfos-nightly-jobs', '15 2 * * *', 'select public.run_nightly_jobs()');
end $$;
