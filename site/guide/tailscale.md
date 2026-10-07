# Tailscale, SSH and Dokploy or Coolify

Putting SSH behind Tailscale is a good idea — but it changes how tools log
in to the server. The typical symptom: from your laptop `ssh` still works,
while Dokploy or Coolify suddenly cannot reach a remote server, and deploys
from GitHub Actions fail.

The agent (1.16.0 and newer) tells you on the server's page which of the two
cases applies, with what to do.

## Why your laptop gets in and Dokploy does not

There are two different things, often both called "SSH over Tailscale":

| What you did                                                       | What changes                                                                                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Closed public SSH** — firewall lets port 22 in only on Tailscale | Only machines **in your tailnet** reach SSH. Anything connecting to the public IP times out.                                                                     |
| **Turned on Tailscale SSH** (`tailscale set --ssh` / `up --ssh`)   | On the 100.x address, **Tailscale answers instead of sshd**. Your tailnet's access rules decide who logs in — the SSH keys in `authorized_keys` no longer count. |

Your laptop is in the tailnet and signed in as you, so both let it in.
Dokploy and Coolify log in with an **SSH key** from a machine that is often
not in the tailnet at all — so they are refused.

## Option A — SSH over the tailnet, with keys (recommended)

Simplest and most robust: keep public SSH closed, but let normal sshd
answer over Tailscale.

1. **On the remote server**, turn Tailscale SSH off (only if it is on):

   ```bash
   sudo tailscale set --ssh=false
   ```

   Your laptop still gets in with your SSH key over Tailscale.

2. **On the machine running Dokploy or Coolify**, join the tailnet:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

   In the Tailscale admin console, turn off key expiry for this machine
   (Machines → … → Disable key expiry) — otherwise it drops off in a few
   months and deploys stop.

3. **In Dokploy** (Remote Servers → the server → Edit) or **Coolify**
   (Servers → the server), change the IP address to the server's
   **100.x.y.z** Tailscale address. The SSH key stays the same.

4. Test the connection from Dokploy or Coolify.

## Option B — keep Tailscale SSH

If you want Tailscale to decide who logs in (no keys to manage on the
servers):

1. Join the Dokploy or Coolify machine to the tailnet as in option A,
   step 2, and give it a tag — for example `tag:dokploy`
   (`sudo tailscale up --advertise-tags=tag:dokploy`).
2. In the Tailscale admin console → **Access controls**, allow it in:

   ```json
   {
     "tagOwners": {
       "tag:dokploy": ["autogroup:admin"],
       "tag:server": ["autogroup:admin"]
     },
     "ssh": [
       {
         "action": "accept",
         "src": ["tag:dokploy"],
         "dst": ["tag:server"],
         "users": ["root"]
       }
     ]
   }
   ```

   Tag the remote servers `tag:server`. Keep the rules you already have
   for yourself, and make sure a network rule (`grants` or `acls`) lets
   `tag:dokploy` reach `tag:server` on port 22.

3. In Dokploy or Coolify, use the server's 100.x address, as in option A.

::: warning "check" does not work for tools
An SSH rule with `"action": "check"` asks for a login in the browser every
so often. You can click that — Dokploy cannot. For tools, the rule must be
`"accept"`.
:::

## SSH only from the Dokploy server — with the agent

Instead of typing ufw rules, let the agent install set them (Setup tab →
"Allow SSH only from", or by hand):

```bash
curl -fsSL <moatline>/api/agent/install.sh | sudo bash -s -- --ssh-from 100.64.0.9,203.0.113.7
```

Use the Dokploy server's 100.x address if it is in your tailnet, otherwise
its public IP, plus your office if you need it. SSH from everywhere else is
closed; the address you are connected from while running it stays allowed,
so it cannot lock you out. It needs ufw to be active. Allow the same
addresses in your provider's firewall (Hetzner Cloud Firewall) as well.

## Still not connecting?

Run this on the Dokploy or Coolify machine, with the key it uses:

```bash
ssh -v -i <key> root@<100.x address of the server>
```

- **Timeout** — the machine is not in the tailnet, or a firewall blocks it.
  `tailscale status` on both sides shows whether they see each other.
- **"tailscale: … not allowed"** or similar — Tailscale SSH is on and no
  rule lets this machine in: option A step 1, or option B step 2.
- **"Permission denied (publickey)"** — sshd answers, but the key is not in
  the server's `authorized_keys`. Add Dokploy's or Coolify's public key
  there again.

If you are locked out completely, your provider's web console (Hetzner:
Console button on the server) always works.
