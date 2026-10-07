import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { probeOfToken, saveResults, targetsFor } from "../services/probes";

/**
 * Where probes in other locations fetch what to check and report what they
 * saw. Authenticated by the probe's token (PROBE_TOKENS), nothing else.
 */
const auth = (header: string | undefined) =>
  probeOfToken(header?.replace(/^Bearer\s+/i, "").trim());

const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string().uuid(),
        ok: z.boolean(),
        httpStatus: z.number().int().min(0).max(999).nullable(),
        error: z.string().max(500).nullable(),
        durationMs: z.number().int().min(0).max(120_000).nullable(),
      })
    )
    .max(500),
});

export const probeRouter = new Hono()
  .get("/targets", async (c) => {
    const probe = auth(c.req.header("authorization"));
    if (!probe) return c.json({ error: "Unknown probe" }, 401);
    return c.json({ probe, targets: await targetsFor(probe) });
  })
  .post("/results", zValidator("json", resultsSchema), async (c) => {
    const probe = auth(c.req.header("authorization"));
    if (!probe) return c.json({ error: "Unknown probe" }, 401);
    const { results } = c.req.valid("json");
    await saveResults(probe, results);
    return c.json({ ok: true, saved: results.length });
  });
