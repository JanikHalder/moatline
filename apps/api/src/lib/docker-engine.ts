import fs from "node:fs";
import http from "node:http";

/** The Docker socket, when it is mounted into this container. */
export const DOCKER_SOCKET = "/var/run/docker.sock";

export function hasDockerSocket(): boolean {
  try {
    return fs.statSync(DOCKER_SOCKET).isSocket();
  } catch {
    return false;
  }
}

/** One call to the Docker Engine API over the local socket. */
export function dockerApi<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 120_000
): Promise<{ status: number; data: T | null; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path: `/v1.43${path}`,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data: T | null = null;
          try {
            data = text ? (JSON.parse(text) as T) : null;
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode ?? 0, data, text });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Docker did not answer")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
