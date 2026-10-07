/** Where a repository deploys to — mirrors repoTarget() on the API. */
export type RepoLinks = {
  dokployApplicationId?: string | null;
  coolifyAppUuid?: string | null;
  platformKind?: string | null;
  platformAppId?: string | null;
};

export function deployPlatform(
  repo: RepoLinks | null | undefined
): "Dokploy" | "Coolify" | "Komodo" | "Portainer" | null {
  if (repo?.dokployApplicationId) return "Dokploy";
  if (repo?.coolifyAppUuid) return "Coolify";
  if (repo?.platformAppId && repo.platformKind === "komodo") return "Komodo";
  if (repo?.platformAppId && repo.platformKind === "portainer")
    return "Portainer";
  return null;
}

export const hasDeployTarget = (repo: RepoLinks | null | undefined) =>
  deployPlatform(repo) !== null;

/**
 * Open the repository's application on its platform. The window is
 * opened right away (a window opened after a request is a blocked popup)
 * and sent to the link once it is known.
 */
export async function openInPlatform(
  repoId: string,
  getLink: (id: string) => Promise<{ url: string }>,
  onError: (message: string) => void
): Promise<void> {
  const win = window.open("about:blank", "_blank");
  try {
    const { url } = await getLink(repoId);
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else window.open(url, "_blank", "noopener");
  } catch (e) {
    win?.close();
    onError(e instanceof Error ? e.message : "Could not open the platform");
  }
}
