// Enum value lists mirroring the database (public schema). UI option sources.

export const ENTITY_TYPES = [
  "group",
  "sub_group",
  "campus",
  "ministry_directorate",
  "ministry_expression",
  "event",
] as const;

export const LEGAL_STATUSES = [
  "incorporated_trustee",
  "separate_foreign_entity",
  "unincorporated_unit",
] as const;

export const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
] as const;

export const FUND_CLASSIFICATIONS = [
  "unrestricted",
  "temporarily_restricted",
  "permanently_restricted",
  "board_designated",
] as const;

export const ACCOUNT_PURPOSES = [
  "tithes_offerings",
  "building_fund",
  "payroll",
  "welfare",
  "operations",
  "investments",
  "other",
] as const;

export const APP_ROLES = [
  "super_admin",
  "group_finance_officer",
  "sub_group_pastor",
  "sub_group_finance_officer",
  "campus_pastor",
  "campus_finance_officer",
  "campus_data_entry_clerk",
  "auditor",
  "governance_officer",
  "ministry_lead",
  "event_finance_lead",
  "campus_admin",
  "group_pastor",
  "global_lead_pastor",
  "head_of_expression",
  "ministry_director",
  "cfo_coo",
  "board_trustee",
  "finance_processor",
  "bank_signatory",
] as const;

/** Roles that are global (no entity scope); all others require an entity_id. */
export const GLOBAL_ROLES = ["super_admin", "auditor"] as const;

export type AppRole = (typeof APP_ROLES)[number];
export const isGlobalRole = (r: string): boolean =>
  (GLOBAL_ROLES as readonly string[]).includes(r);

export type EntityType = (typeof ENTITY_TYPES)[number];
export type LegalStatus = (typeof LEGAL_STATUSES)[number];
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type FundClassification = (typeof FUND_CLASSIFICATIONS)[number];
export type AccountPurpose = (typeof ACCOUNT_PURPOSES)[number];

export const GIVING_CHANNELS = [
  "cash",
  "pos",
  "bank_transfer",
  "online_paystack",
  "ussd",
  "standing_order",
] as const;

export const PLEDGE_TYPES = ["building_fund", "missions", "vow"] as const;

/** Pledge type -> the giving type its payments are recorded as. */
export const PLEDGE_TYPE_TO_GIVING_CODE: Record<string, string> = {
  building_fund: "building_fund",
  missions: "missions_pledge",
  vow: "vow",
};

/** "sub_group" -> "Sub Group" */
export const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
