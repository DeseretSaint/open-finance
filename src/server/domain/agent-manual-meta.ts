export const MANUAL_DOMAIN_KEYS = ["categorization", "budgeting", "general"] as const;
export type ManualDomainKey = (typeof MANUAL_DOMAIN_KEYS)[number];

/** Max length per domain text (keeps the agent prompt bounded). */
export const MANUAL_MAX_LEN = 4000;
