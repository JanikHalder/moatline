/** What a run was doing, for error messages: "Failed while opening the PR: …". */
const PHASES: Record<string, string> = {
  clone: "cloning the repository",
  check_updates: "looking up newer versions",
  install: "installing dependencies",
  audit_fix: "fixing the lockfile",
  waiting: "waiting for the build slot",
  build: "checking the build",
  test: "running the tests",
  commit_push: "committing and pushing",
  pr: "opening the pull request",
  ci: "waiting for the CI checks",
};

export function failedWhile(phase: string | null, message: string): string {
  const what = phase ? (PHASES[phase] ?? phase) : null;
  return what ? `Failed while ${what}: ${message}` : message;
}
