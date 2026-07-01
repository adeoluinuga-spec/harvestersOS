// Enum value lists mirroring the database (public schema). UI option sources.

export const ENTITY_TYPES = [
  "group",
  "sub_group",
  "campus",
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

export type EntityType = (typeof ENTITY_TYPES)[number];
export type LegalStatus = (typeof LEGAL_STATUSES)[number];
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type FundClassification = (typeof FUND_CLASSIFICATIONS)[number];
export type AccountPurpose = (typeof ACCOUNT_PURPOSES)[number];

/** "sub_group" -> "Sub Group" */
export const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
