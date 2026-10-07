import "./load-env.mjs";
import { auth } from "../auth";

const DEMO_EMAIL = "demo@example.com";
const DEMO_NAME = "Demo User";
const DEMO_PASSWORD = "demo1234";

function isAlreadyExistsError(e: unknown): boolean {
  const msg = String(
    (e as { body?: { message?: string }; message?: string }).body?.message ??
      (e as { message?: string }).message ??
      ""
  ).toLowerCase();
  const code = (e as { body?: { code?: string } }).body?.code ?? "";
  return (
    msg.includes("already exists") ||
    msg.includes("unique") ||
    code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  );
}

async function main() {
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: DEMO_EMAIL,
        name: DEMO_NAME,
        password: DEMO_PASSWORD,
      },
    });

    const err =
      result && typeof result === "object" && "error" in result
        ? (result as { error?: { message?: string } }).error
        : null;
    if (err) {
      if (
        String(err.message || "")
          .toLowerCase()
          .includes("already exists") ||
        String(err.message || "")
          .toLowerCase()
          .includes("unique")
      ) {
        console.log("Demo user already exists:", DEMO_EMAIL);
        process.exit(0);
      }
      console.error("Failed to create demo user:", err);
      process.exit(1);
    }

    console.log("Demo user created.");
    console.log("  Email:", DEMO_EMAIL);
    console.log("  Password:", DEMO_PASSWORD);
  } catch (e) {
    if (isAlreadyExistsError(e)) {
      console.log("Demo user already exists:", DEMO_EMAIL);
      process.exit(0);
    }
    throw e;
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
