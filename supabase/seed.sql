-- ===========================================================================
-- Harvesters Finance OS — Seed data (idempotent)
-- Real-shaped Harvesters structure + a starter global chart of accounts +
-- sample bank accounts (encrypted). Safe to re-run.
-- ===========================================================================

-- --- Entity hierarchy -------------------------------------------------------
do $$
declare
  g   uuid;  -- Group
  ng  uuid;  -- Sub-group: Nigeria
  uk  uuid;  -- Sub-group: UK & Europe
  na  uuid;  -- Sub-group: North America
  gb  uuid;  -- Campus: Gbagada
  lk  uuid;  -- Campus: Lekki
  ld  uuid;  -- Campus: London (non-NGN)
  hs  uuid;  -- Campus: Houston (non-NGN)
begin
  -- Top-level Group
  select id into g from public.entities where type = 'group'
    and name = 'Harvesters International Christian Centre';
  if g is null then
    insert into public.entities (type, name, country, functional_currency, legal_status)
    values ('group', 'Harvesters International Christian Centre', 'NG', 'NGN', 'incorporated_trustee')
    returning id into g;
  end if;

  -- Sub-groups (regional)
  select id into ng from public.entities where name = 'Harvesters Nigeria';
  if ng is null then
    insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
    values ('sub_group', g, 'Harvesters Nigeria', 'NG', 'NGN', 'unincorporated_unit')
    returning id into ng;
  end if;

  select id into uk from public.entities where name = 'Harvesters UK & Europe';
  if uk is null then
    insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
    values ('sub_group', g, 'Harvesters UK & Europe', 'GB', 'GBP', 'separate_foreign_entity')
    returning id into uk;
  end if;

  select id into na from public.entities where name = 'Harvesters North America';
  if na is null then
    insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
    values ('sub_group', g, 'Harvesters North America', 'US', 'USD', 'separate_foreign_entity')
    returning id into na;
  end if;

  -- Campuses under Nigeria
  select id into gb from public.entities where name = 'Gbagada Campus';
  if gb is null then
    insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
    values ('campus', ng, 'Gbagada Campus', 'NG', 'NGN', 'unincorporated_unit')
    returning id into gb;
  end if;

  select id into lk from public.entities where name = 'Lekki Campus';
  if lk is null then
    insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
    values ('campus', ng, 'Lekki Campus', 'NG', 'NGN', 'unincorporated_unit')
    returning id into lk;
  end if;

  -- International campus (non-NGN functional currency)
  select id into ld from public.entities where name = 'London Campus';
  if ld is null then
    insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
    values ('campus', uk, 'London Campus', 'GB', 'GBP', 'separate_foreign_entity')
    returning id into ld;
  end if;

  select id into hs from public.entities where name = 'Houston Campus';
  if hs is null then
    insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
    values ('campus', na, 'Houston Campus', 'US', 'USD', 'separate_foreign_entity')
    returning id into hs;
  end if;

  -- Ministry Expression (parallel node under the Group)
  if not exists (select 1 from public.entities where name = 'Next Level Prayers') then
    insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
    values ('ministry_expression', g, 'Next Level Prayers', 'NG', 'NGN', 'unincorporated_unit');
  end if;

  -- Temporary Event entity, hosted by Gbagada Campus
  if not exists (select 1 from public.entities where name = 'The Harvest Conference 2026') then
    insert into public.entities
      (type, parent_entity_id, name, country, functional_currency, legal_status, start_date, end_date)
    values
      ('event', gb, 'The Harvest Conference 2026', 'NG', 'NGN', 'unincorporated_unit',
       date '2026-11-18', date '2026-11-22');
  end if;

  -- --- Sample bank accounts (encrypted at rest) ---------------------------
  if not exists (select 1 from public.bank_accounts where entity_id = gb) then
    perform public.create_bank_account(gb, 'Guaranty Trust Bank', '0123456789', 'tithes_offerings', 'NGN');
    perform public.create_bank_account(gb, 'Zenith Bank',         '1011121314', 'building_fund',    'NGN');
  end if;
  if not exists (select 1 from public.bank_accounts where entity_id = ld) then
    perform public.create_bank_account(ld, 'Barclays UK', '20993456', 'operations', 'GBP');
  end if;
end $$;

-- --- Global chart of accounts ----------------------------------------------
insert into public.accounts (code, name, account_type, fund_classification) values
  ('1000', 'Cash on Hand',              'asset',     'unrestricted'),
  ('1010', 'Bank - Operations',         'asset',     'unrestricted'),
  ('1020', 'Bank - Building Fund',      'asset',     'temporarily_restricted'),
  ('2000', 'Accounts Payable',          'liability', 'unrestricted'),
  ('2100', 'Payroll Liabilities',       'liability', 'unrestricted'),
  ('3000', 'Unrestricted Net Assets',   'equity',    'unrestricted'),
  ('3100', 'Restricted Net Assets',     'equity',    'temporarily_restricted'),
  ('4000', 'Tithes',                    'income',    'unrestricted'),
  ('4010', 'Offerings',                 'income',    'unrestricted'),
  ('4020', 'Building Fund Giving',       'income',    'temporarily_restricted'),
  ('4030', 'Seed & Partnership',        'income',    'unrestricted'),
  ('4040', 'Next Level Prayers Giving', 'income',    'temporarily_restricted'),
  ('5000', 'Salaries & Wages',          'expense',   'unrestricted'),
  ('5010', 'Rent & Facilities',         'expense',   'unrestricted'),
  ('5020', 'Welfare & Benevolence',     'expense',   'unrestricted'),
  ('5030', 'Missions & Outreach',       'expense',   'unrestricted'),
  ('6000', 'Utilities',                 'expense',   'unrestricted')
on conflict (code) do nothing;
