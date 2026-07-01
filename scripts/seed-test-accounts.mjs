// Seed Harvesters OS test users, hierarchy, and role slots.
// Usage: node --env-file=.env.local scripts/seed-test-accounts.mjs
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const PASSWORD = "Test1234!";
const domain = "harvestersng.org";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "DATABASE_URL"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`${key} is required.`);
    process.exit(1);
  }
}

const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = hasServiceRole
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  : null;
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });

const email = (local) => `${local.toLowerCase()}@${domain}`;
const title = (s) => s.replace(/[-_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const users = new Map();

async function ensureUser(localPart, fullName) {
  const mail = localPart.includes("@") ? localPart.toLowerCase() : email(localPart);
  if (users.has(mail)) return users.get(mail);

  let user = null;
  if (supabase) {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: mail,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        seeded_placeholder: true,
      },
    });

    if (error && !String(error.message).toLowerCase().includes("already")) {
      throw new Error(`createUser ${mail}: ${error.message}`);
    }

    user = created?.user ?? null;
    if (!user) {
      const { data: list, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw new Error(`listUsers: ${listError.message}`);
      user = list.users.find((u) => u.email?.toLowerCase() === mail);
    }
    if (!user) throw new Error(`Could not find or create ${mail}`);

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...(user.user_metadata ?? {}),
        full_name: fullName,
        seeded_placeholder: true,
      },
    });
    if (updateError) throw new Error(`updateUser ${mail}: ${updateError.message}`);
  } else {
    let [row] = await sql`
      select id, email from auth.users where lower(email) = lower(${mail}::text)`;
    if (!row) {
      [row] = await sql`
        insert into auth.users
          (instance_id, id, aud, role, email, encrypted_password,
           email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
           created_at, updated_at, confirmation_token, recovery_token,
           email_change_token_new, email_change)
        values
          ('00000000-0000-0000-0000-000000000000'::uuid,
           gen_random_uuid(),
           'authenticated',
           'authenticated',
           ${mail}::text,
           extensions.crypt(${PASSWORD}::text, extensions.gen_salt('bf')),
           now(),
           '{"provider":"email","providers":["email"]}'::jsonb,
           jsonb_build_object('full_name', ${fullName}::text, 'seeded_placeholder', true),
           now(),
           now(),
           '',
           '',
           '',
           '')
        returning id, email`;
    } else {
      [row] = await sql`
        update auth.users
           set encrypted_password = extensions.crypt(${PASSWORD}::text, extensions.gen_salt('bf')),
               email_confirmed_at = coalesce(email_confirmed_at, now()),
               raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
               raw_user_meta_data = jsonb_build_object('full_name', ${fullName}::text, 'seeded_placeholder', true),
               updated_at = now()
         where id = ${row.id}
         returning id, email`;
    }

    await sql`
      insert into auth.identities
        (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        (${row.id}::text, ${row.id}, jsonb_build_object('sub', ${row.id}::text, 'email', ${mail}::text),
         'email', now(), now(), now())
      on conflict do nothing`;
    user = row;
  }

  users.set(mail, user);
  return user;
}

async function ensureRoot() {
  const [existing] = await sql`
    select id from public.entities
    where name = 'Harvesters International Christian Centre'
    order by created_at limit 1`;
  if (existing) return existing.id;
  const [row] = await sql`
    insert into public.entities (type, name, country, functional_currency, legal_status)
    values ('group', 'Harvesters International Christian Centre', 'NG', 'NGN', 'incorporated_trustee')
    returning id`;
  return row.id;
}

async function ensureEntity({ type, parentId, name, country = "NG", currency = "NGN", legal = "unincorporated_unit" }) {
  const [existing] = await sql`
    select id from public.entities where lower(name) = lower(${name}) limit 1`;
  if (existing) {
    await sql`
      update public.entities
         set type = ${type}::public.entity_type,
             parent_entity_id = ${parentId},
             country = ${country},
             functional_currency = ${currency},
             legal_status = ${legal}::public.legal_status,
             is_active = true
       where id = ${existing.id}`;
    return existing.id;
  }
  const [row] = await sql`
    insert into public.entities
      (type, parent_entity_id, name, country, functional_currency, legal_status)
    values
      (${type}::public.entity_type, ${parentId}, ${name}, ${country}, ${currency}, ${legal}::public.legal_status)
    returning id`;
  return row.id;
}

async function grantRole(userId, role, entityId = null) {
  await sql`
    insert into public.user_entity_roles (user_id, entity_id, role, granted_by)
    values (${userId}, ${entityId}, ${role}::public.app_role, ${userId})
    on conflict do nothing`;
}

async function slot({ key, cadre, user, entityId, role, notes }) {
  await sql`
    insert into public.seeded_role_slots
      (slot_key, cadre, placeholder_email, current_user_id, entity_id, role, is_placeholder, notes)
    values
      (${key}, ${cadre}, ${user.email}, ${user.id}, ${entityId}, ${role}::public.app_role, true, ${notes ?? null})
    on conflict (slot_key) do update
      set placeholder_email = excluded.placeholder_email,
          current_user_id = excluded.current_user_id,
          entity_id = excluded.entity_id,
          role = excluded.role,
          cadre = excluded.cadre,
          is_placeholder = true,
          notes = excluded.notes`;
}

async function seed() {
  console.log("Seeding Harvesters test org/users...");
  const rootId = await ensureRoot();

  const admin = await ensureUser("admin", "Harvesters OS Super Admin");
  const glp = await ensureUser("globalleadpastor", "Global Lead Pastor");
  const cfo = await ensureUser("cfo", "CFO");

  await grantRole(admin.id, "super_admin");
  await grantRole(cfo.id, "super_admin");
  await grantRole(cfo.id, "cfo_coo", rootId);
  await grantRole(glp.id, "global_lead_pastor", rootId);

  await slot({ key: "global.super_admin", cadre: "system_admin", user: admin, entityId: null, role: "super_admin", notes: "Primary test superadmin." });
  await slot({ key: "global.cfo", cadre: "executive_finance", user: cfo, entityId: rootId, role: "cfo_coo", notes: "CFO also has super_admin for test administration." });
  await slot({ key: "global.lead_pastor", cadre: "executive_pastoral", user: glp, entityId: rootId, role: "global_lead_pastor" });

  for (let g = 1; g <= 4; g++) {
    const groupId = await ensureEntity({
      type: "group",
      parentId: rootId,
      name: `Harvesters Group ${g}`,
    });

    const pastor = await ensureUser(`grp${g}pastor`, `Group ${g} Pastor`);
    const accountant = await ensureUser(`grp${g}accountant`, `Group ${g} Accountant`);
    await grantRole(pastor.id, "group_pastor", groupId);
    await grantRole(accountant.id, "group_finance_officer", groupId);
    await slot({ key: `group.${g}.pastor`, cadre: "group_pastor", user: pastor, entityId: groupId, role: "group_pastor" });
    await slot({ key: `group.${g}.accountant`, cadre: "group_accountant", user: accountant, entityId: groupId, role: "group_finance_officer" });

    for (let s = 1; s <= 4; s++) {
      const subgroupId = await ensureEntity({
        type: "sub_group",
        parentId: groupId,
        name: `Group ${g} Subgroup ${s}`,
      });
      const subgroupAccountant = await ensureUser(`grp${g}sub${s}accountant`, `Group ${g} Subgroup ${s} Accountant`);
      await grantRole(subgroupAccountant.id, "sub_group_finance_officer", subgroupId);
      await slot({
        key: `group.${g}.subgroup.${s}.accountant`,
        cadre: "subgroup_accountant",
        user: subgroupAccountant,
        entityId: subgroupId,
        role: "sub_group_finance_officer",
      });

      for (let c = 1; c <= 5; c++) {
        const campusId = await ensureEntity({
          type: "campus",
          parentId: subgroupId,
          name: `Group ${g} Subgroup ${s} Campus ${c}`,
        });
        const campusAdmin = await ensureUser(`grp${g}sub${s}campus${c}admin`, `Group ${g} Subgroup ${s} Campus ${c} Administrator`);
        await grantRole(campusAdmin.id, "campus_admin", campusId);
        await slot({
          key: `group.${g}.subgroup.${s}.campus.${c}.admin`,
          cadre: "campus_administrator",
          user: campusAdmin,
          entityId: campusId,
          role: "campus_admin",
        });
      }
    }
  }

  const ministries = [
    ["next-level-prayers", "Next Level Prayers", "nlphead", "Next Level Prayers Ministry Head"],
    ["haef", "Harvesters African Empowerment Foundation", "haefhead", "Harvesters African Empowerment Foundation Ministry Head"],
  ];
  for (const [key, name, localPart, fullName] of ministries) {
    const entityId = await ensureEntity({
      type: "ministry_directorate",
      parentId: rootId,
      name,
    });
    const head = await ensureUser(localPart, fullName);
    await grantRole(head.id, "ministry_lead", entityId);
    await slot({
      key: `ministry.${key}.head`,
      cadre: "ministry_head",
      user: head,
      entityId,
      role: "ministry_lead",
    });
  }

  const totalUsers = users.size;
  const [{ role_count }] = await sql`select count(*)::int as role_count from public.seeded_role_slots`;
  console.log(`Done. Seeded/updated ${totalUsers} auth users and ${role_count} role slots.`);
  console.log(`Login: admin@${domain} / ${PASSWORD}`);
}

try {
  await seed();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
