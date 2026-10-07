import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { api, type AgentUpdate } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeBlock, CodeLine } from "@/components/server-ui";
import { useT } from "@/lib/i18n";

/** Hostnames and IPs only — anything else never goes into a shell line. */
const SAFE_HOST = /^[A-Za-z0-9.:-]+$/;

/**
 * Agents behind the current version, and the commands that update them:
 * one for a single server, one loop over SSH for all of them. The agent
 * takes no commands, so a person runs these.
 */
export function AgentUpdateAlert() {
  const t = useT();
  const [data, setData] = useState<AgentUpdate | null>(null);
  const [user, setUser] = useState("root");

  useEffect(() => {
    api
      .getAgentUpdate()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data?.servers.length) return null;
  const reachable = data.servers.filter(
    (s) => s.address && SAFE_HOST.test(s.address)
  );
  const others = data.servers.filter((s) => !reachable.includes(s));
  const login = /^[a-z_][a-z0-9_-]*$/.test(user) ? `${user}@` : "";
  const loop = [
    `for h in ${reachable.map((s) => s.address).join(" ")}; do`,
    `  echo "== $h"`,
    `  ssh ${login}"$h" '${data.command}'`,
    `done`,
  ].join("\n");

  return (
    <Alert variant="warning">
      <RefreshCw />
      <AlertTitle>
        {t(
          data.servers.length === 1
            ? "{n} agent is not on version {v}"
            : "{n} agents are not on version {v}",
          { n: data.servers.length, v: data.latest ?? "" }
        )}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {data.servers.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <Link
                to="/servers/$serverId"
                params={{ serverId: s.id }}
                className="underline underline-offset-2"
              >
                {s.name}
              </Link>{" "}
              ({s.agentVersion})
            </span>
          ))}
        </p>
        <div className="space-y-1">
          <p className="text-xs">
            {t(
              "On one server — replaces only the agent, keeps token and settings:"
            )}
          </p>
          <CodeLine text={data.command} label={t("agent update command")} />
        </div>
        {reachable.length > 1 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs">
                {t("All at once from your machine, over SSH, as")}
              </p>
              <Label htmlFor="agent-update-user" className="sr-only">
                {t("SSH user")}
              </Label>
              <Input
                id="agent-update-user"
                value={user}
                onChange={(e) => setUser(e.target.value.trim())}
                className="h-7 w-28 font-mono text-xs"
              />
            </div>
            <CodeBlock text={loop} label={t("update loop")} />
          </div>
        )}
        {reachable.length > 1 && others.length > 0 && (
          <p className="text-xs">
            {t("Without an address, so not in the loop: {list}", {
              list: others.map((s) => s.name).join(", "),
            })}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
