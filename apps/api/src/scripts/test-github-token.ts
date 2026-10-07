import "../load-env";

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

const TEST_REPO = { owner: "facebook", repo: "react", branch: "main" };

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("GITHUB_TOKEN is not set. Testing public repo access only...");
  } else {
    console.log("GITHUB_TOKEN is set. Testing GitHub API access...");
  }

  if (token) {
    const url = `${GITHUB_API}/repos/${TEST_REPO.owner}/${TEST_REPO.repo}/contents/package.json?ref=${TEST_REPO.branch}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw",
      },
    });
    if (!res.ok) {
      console.error(
        `GitHub API failed: ${res.status} ${res.statusText}`,
        await res.text().catch(() => "")
      );
      process.exit(1);
    }
    const text = await res.text();
    let pkg: { name?: string; dependencies?: Record<string, unknown> };
    try {
      pkg = JSON.parse(text);
    } catch {
      console.error("Invalid JSON in package.json response");
      process.exit(1);
    }
    if (!pkg || typeof pkg !== "object") {
      console.error("Unexpected package.json shape");
      process.exit(1);
    }
    const depCount =
      (pkg.dependencies && Object.keys(pkg.dependencies).length) || 0;
    console.log(
      `OK – GitHub API: fetched package.json for ${TEST_REPO.owner}/${TEST_REPO.repo}${pkg.name ? ` (name: ${pkg.name})` : ""}${depCount ? `, ${depCount} dependencies` : ""}.`
    );
    process.exit(0);
  }

  const rawUrl = `${GITHUB_RAW}/${TEST_REPO.owner}/${TEST_REPO.repo}/${TEST_REPO.branch}/package.json`;
  const res = await fetch(rawUrl);
  if (!res.ok) {
    console.error(`Raw GitHub failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const pkg = (await res.json()) as { name?: string };
  console.log(
    `OK – Public raw: fetched package.json for ${TEST_REPO.owner}/${TEST_REPO.repo}${pkg?.name ? ` (name: ${pkg.name})` : ""}.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
