import { and, count, desc, gte, inArray, isNotNull, sql } from "drizzle-orm";
import {
  billingAccounts,
  db,
  member,
  organization,
  repositories,
  servers,
  session,
  user,
} from "db";
import { planById } from "./billing";

/**
 * How the hosted service is doing, for whoever runs it: accounts,
 * activity, what they set up, who pays. Across every organization — so
 * only for the operators named in OPERATOR_EMAILS.
 */

const DAY = 24 * 60 * 60 * 1000;
const PAYING = ["active", "trialing", "past_due"];

/** Operators of this instance: OPERATOR_EMAILS, comma-separated. */
export function isOperator(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

export type OperatorStats = {
  users: {
    total: number;
    verified: number;
    new7d: number;
    new30d: number;
    active7d: number;
    active30d: number;
  };
  /** Sign-ups per week, oldest first, the last 12 weeks. */
  signupsByWeek: Array<{ week: string; count: number }>;
  organizations: {
    total: number;
    withServer: number;
    withRepository: number;
  };
  servers: { total: number; reporting24h: number };
  repositories: number;
  billing: {
    paying: number;
    trialing: number;
    pastDue: number;
    canceled: number;
    /** Monthly recurring revenue in euros, from the plans' list prices. */
    mrrEur: number;
    byPlan: Record<string, number>;
  };
  recent: Array<{
    email: string;
    name: string | null;
    createdAt: string;
    verified: boolean;
    lastActiveAt: string | null;
    organizations: string[];
    servers: number;
    repositories: number;
    plan: string | null;
  }>;
};

export async function operatorStats(now = Date.now()): Promise<OperatorStats> {
  const d7 = new Date(now - 7 * DAY);
  const d30 = new Date(now - 30 * DAY);
  const d84 = new Date(now - 84 * DAY);
  const n = (rows: Array<{ n: number | string }>) => Number(rows[0]?.n ?? 0);

  const [
    usersTotal,
    usersVerified,
    usersNew7,
    usersNew30,
    active7,
    active30,
    weeks,
    orgsTotal,
    orgsWithServer,
    orgsWithRepo,
    serversTotal,
    serversReporting,
    reposTotal,
    accounts,
    recentUsers,
  ] = await Promise.all([
    db.select({ n: count() }).from(user),
    db
      .select({ n: count() })
      .from(user)
      .where(sql`${user.emailVerified} = true`),
    db.select({ n: count() }).from(user).where(gte(user.createdAt, d7)),
    db.select({ n: count() }).from(user).where(gte(user.createdAt, d30)),
    db
      .select({ n: sql<number>`count(distinct ${session.userId})` })
      .from(session)
      .where(gte(session.updatedAt, d7)),
    db
      .select({ n: sql<number>`count(distinct ${session.userId})` })
      .from(session)
      .where(gte(session.updatedAt, d30)),
    db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${user.createdAt}), 'YYYY-MM-DD')`,
        n: count(),
      })
      .from(user)
      .where(gte(user.createdAt, d84))
      .groupBy(sql`date_trunc('week', ${user.createdAt})`),
    db.select({ n: count() }).from(organization),
    db
      .select({ n: sql<number>`count(distinct ${servers.organizationId})` })
      .from(servers),
    db
      .select({
        n: sql<number>`count(distinct ${repositories.organizationId})`,
      })
      .from(repositories),
    db.select({ n: count() }).from(servers),
    db
      .select({ n: count() })
      .from(servers)
      .where(gte(servers.lastReportAt, new Date(now - DAY))),
    db.select({ n: count() }).from(repositories),
    db
      .select({
        organizationId: billingAccounts.organizationId,
        status: billingAccounts.status,
        plan: billingAccounts.plan,
      })
      .from(billingAccounts)
      .where(isNotNull(billingAccounts.status)),
    db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        verified: user.emailVerified,
      })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(25),
  ]);

  // Weeks without a sign-up count as 0, so the chart has no gaps.
  const byWeek = new Map(weeks.map((w) => [w.week, Number(w.n)]));
  const signupsByWeek: OperatorStats["signupsByWeek"] = [];
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  for (let i = 11; i >= 0; i--) {
    const w = new Date(monday.getTime() - i * 7 * DAY)
      .toISOString()
      .slice(0, 10);
    signupsByWeek.push({ week: w, count: byWeek.get(w) ?? 0 });
  }

  const billing: OperatorStats["billing"] = {
    paying: 0,
    trialing: 0,
    pastDue: 0,
    canceled: 0,
    mrrEur: 0,
    byPlan: {},
  };
  const planOfOrg = new Map<string, string>();
  for (const a of accounts) {
    if (a.status === "canceled") billing.canceled++;
    if (!a.status || !PAYING.includes(a.status)) continue;
    if (a.status === "trialing") billing.trialing++;
    else billing.paying++;
    if (a.status === "past_due") billing.pastDue++;
    const plan = planById(a.plan);
    const key = plan?.name ?? a.plan ?? "unknown";
    billing.byPlan[key] = (billing.byPlan[key] ?? 0) + 1;
    if (a.status !== "trialing") billing.mrrEur += plan?.eur ?? 0;
    planOfOrg.set(a.organizationId, key);
  }

  // The newest accounts with what they set up.
  const ids = recentUsers.map((u) => u.id);
  const [memberships, lastActive] = ids.length
    ? await Promise.all([
        db
          .select({
            userId: member.userId,
            orgId: organization.id,
            orgName: organization.name,
          })
          .from(member)
          .innerJoin(
            organization,
            sql`${organization.id} = ${member.organizationId}`
          )
          .where(inArray(member.userId, ids)),
        db
          .select({
            userId: session.userId,
            at: sql<Date>`max(${session.updatedAt})`.mapWith(session.updatedAt),
          })
          .from(session)
          .where(inArray(session.userId, ids))
          .groupBy(session.userId),
      ])
    : [[], []];
  const orgIds = [...new Set(memberships.map((m) => m.orgId))];
  const [serverCounts, repoCounts] = orgIds.length
    ? await Promise.all([
        db
          .select({ orgId: servers.organizationId, n: count() })
          .from(servers)
          .where(inArray(servers.organizationId, orgIds))
          .groupBy(servers.organizationId),
        db
          .select({ orgId: repositories.organizationId, n: count() })
          .from(repositories)
          .where(
            and(
              inArray(repositories.organizationId, orgIds),
              isNotNull(repositories.organizationId)
            )
          )
          .groupBy(repositories.organizationId),
      ])
    : [[], []];
  const sCount = new Map(serverCounts.map((r) => [r.orgId, Number(r.n)]));
  const rCount = new Map(repoCounts.map((r) => [r.orgId, Number(r.n)]));
  const seen = new Map(lastActive.map((r) => [r.userId, r.at]));

  return {
    users: {
      total: n(usersTotal),
      verified: n(usersVerified),
      new7d: n(usersNew7),
      new30d: n(usersNew30),
      active7d: n(active7),
      active30d: n(active30),
    },
    signupsByWeek,
    organizations: {
      total: n(orgsTotal),
      withServer: n(orgsWithServer),
      withRepository: n(orgsWithRepo),
    },
    servers: { total: n(serversTotal), reporting24h: n(serversReporting) },
    repositories: n(reposTotal),
    billing,
    recent: recentUsers.map((u) => {
      const orgs = memberships.filter((m) => m.userId === u.id);
      const at = seen.get(u.id);
      return {
        email: u.email,
        name: u.name || null,
        createdAt: u.createdAt.toISOString(),
        verified: u.verified,
        lastActiveAt: at ? new Date(at).toISOString() : null,
        organizations: orgs.map((o) => o.orgName),
        servers: orgs.reduce((s, o) => s + (sCount.get(o.orgId) ?? 0), 0),
        repositories: orgs.reduce((s, o) => s + (rCount.get(o.orgId) ?? 0), 0),
        plan: orgs.map((o) => planOfOrg.get(o.orgId)).find(Boolean) ?? null,
      };
    }),
  };
}
