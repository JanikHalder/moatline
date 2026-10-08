export type AutomationPolicy = {
  defaultAutoFixCritical: boolean;
  allowMcpSecurityFix: boolean;
  requirePrReview: boolean;
};

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  defaultAutoFixCritical: false,
  allowMcpSecurityFix: true,
  requirePrReview: false,
};

export function resolveAutomationPolicy(raw: unknown): AutomationPolicy {
  const o =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    defaultAutoFixCritical: o.defaultAutoFixCritical === true,
    allowMcpSecurityFix: o.allowMcpSecurityFix !== false,
    requirePrReview: o.requirePrReview === true,
  };
}
