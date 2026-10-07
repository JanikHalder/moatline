import "./load-env.mjs";
import { db } from "db";
import { user, organization, member } from "db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

const DEMO_EMAIL = "demo@example.com";
const DEMO_ORG_SLUG = "demo";
const DEMO_ORG_NAME = "Demo Organization";

async function main() {
  const [demoUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, DEMO_EMAIL))
    .limit(1);

  if (!demoUser) {
    console.error(
      "Demo user not found. Run first: pnpm --filter api seed:demo"
    );
    process.exit(1);
  }

  const [existing] = await db
    .select()
    .from(organization)
    .where(eq(organization.slug, DEMO_ORG_SLUG))
    .limit(1);

  if (existing) {
    const [existingMember] = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.organizationId, existing.id),
          eq(member.userId, demoUser.id)
        )
      )
      .limit(1);
    if (existingMember) {
      console.log("Demo organization already exists:", DEMO_ORG_NAME);
      process.exit(0);
    }
    await db.insert(member).values({
      id: randomUUID(),
      userId: demoUser.id,
      organizationId: existing.id,
      role: "owner",
    });
    console.log("Demo user added to existing demo organization.");
    process.exit(0);
  }

  const orgId = randomUUID();
  await db.insert(organization).values({
    id: orgId,
    name: DEMO_ORG_NAME,
    slug: DEMO_ORG_SLUG,
  });

  await db.insert(member).values({
    id: randomUUID(),
    userId: demoUser.id,
    organizationId: orgId,
    role: "owner",
  });

  console.log("Demo organization created.");
  console.log("  Name:", DEMO_ORG_NAME);
  console.log("  Slug:", DEMO_ORG_SLUG);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
