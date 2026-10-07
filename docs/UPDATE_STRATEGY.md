# Update strategy: safe dependency updates

Goal: update dependencies **without risking the main application**. Every update runs in isolation and always uses a **new branch**.

## Principles

1. **Always a new branch**  
   Each "Update packages" run gets a dedicated branch (e.g. `deps/update-1739123456789`). The default branch is never changed.

2. **Isolated execution**  
   Clone the repo into a **temporary directory**. All steps (ncu, install, build, git push) run there. The API process and its `node_modules` are never touched.

3. **Optional build check**  
   After updating `package.json` (and lockfile), we can run `npm install` and `npm run build` in the temp clone. If the build fails, we still push the branch but mark the run as `buildOk: false` and store the log. The user can fix the branch or discard it.

4. **No impact on main app**  
   Crashes, timeouts, or errors in the workflow only affect the update run (status + log). The API keeps running; no shared state is modified except the DB row for that run.

## Flow

```
User clicks "Update packages"
  → API creates update_run (branchName: deps/update-<timestamp>)
  → runUpdateWorkflow(runId) runs asynchronously (.catch() so unhandled errors don’t kill the process)

Workflow (all in temp dir):
  1. Clone repo (default branch) into temp
  2. Git checkout -b <branchName>
  3. In project dir (repo root or packageJsonPath parent):
     - npx npm-check-updates -u   (updates package.json)
     - npm install                (refresh lockfile)
     - [optional] npm run build   (if script exists; timeout e.g. 5 min)
  4. Git add package.json (and lockfile), commit, push origin <branchName>
  5. DB: status = pushed, buildOk = true/false, logOutput = combined log
```

If any step fails (clone, ncu, install, build, push), we set `status: failed` and store the error in `logOutput`. The branch may or may not exist on the remote depending on where it failed.

## Requirements

- **GITHUB_TOKEN** with repo push access (for clone + push). Without it, the workflow fails at clone/push.
- **npm** (or the project’s package manager) available on the PATH where the API runs.
- **git** available.

## User workflow after an update run

- Open the repo on GitHub and see the new branch.
- Open a PR from that branch to the default branch.
- Review diff (package.json + lockfile), run CI if desired, then merge or close.
