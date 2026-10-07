import net from "node:net";
import type { Context } from "hono";

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/). They
 * change rarely; CLOUDFLARE_IPS (comma-separated CIDRs) replaces the list.
 */
const CLOUDFLARE_DEFAULT = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

let cloudflare: net.BlockList | null = null;

function cloudflareRanges(): net.BlockList {
  if (cloudflare) return cloudflare;
  const list = new net.BlockList();
  const cidrs = process.env.CLOUDFLARE_IPS
    ? process.env.CLOUDFLARE_IPS.split(",").map((s) => s.trim())
    : CLOUDFLARE_DEFAULT;
  for (const cidr of cidrs) {
    const [addr, bits] = cidr.split("/");
    const type = net.isIPv6(addr ?? "") ? "ipv6" : "ipv4";
    if (addr && bits && net.isIP(addr))
      list.addSubnet(addr, Number(bits), type);
  }
  cloudflare = list;
  return list;
}

export function isCloudflare(ip: string): boolean {
  const type = net.isIPv6(ip) ? "ipv6" : net.isIPv4(ip) ? "ipv4" : null;
  return !!type && cloudflareRanges().check(ip, type);
}

/**
 * The client's IP, in a way the client cannot choose.
 *
 * The reverse proxy in front of the app (Traefik, nginx) appends the address
 * it received the request from to X-Forwarded-For — that right-most entry is
 * the only one nobody upstream could have written. If it is a Cloudflare edge,
 * Cloudflare's CF-Connecting-IP names the real client; from anywhere else
 * (someone reaching the origin directly) that header is ignored, because then
 * the caller could have set it to anything.
 */
export function clientIp(c: Context): string {
  return clientIpFromHeaders((name) => c.req.header(name));
}

/** The same, for code that only has the request headers (auth hooks). */
export function clientIpFromHeaders(
  header: (name: string) => string | null | undefined
): string {
  const chain = (header("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const peer = chain[chain.length - 1] ?? header("x-real-ip") ?? null;
  if (!peer) return "unknown";
  const cf = header("cf-connecting-ip")?.trim();
  if (cf && net.isIP(cf) && isCloudflare(peer)) return cf;
  return peer;
}

const NOT_PUBLIC = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const)
  NOT_PUBLIC.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  NOT_PUBLIC.addSubnet(addr, prefix, "ipv6");

/**
 * An address on the internet — not loopback, LAN, tailnet or a proxy's
 * Docker network (which is what a misread forwarded header gives).
 */
export function isPublicIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (!v) return false;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicIp(mapped[1]!);
  return !NOT_PUBLIC.check(ip, v === 4 ? "ipv4" : "ipv6");
}
