import { defineConnector } from "@openislands/connector-kit";
import { z } from "zod";

/**
 * Whoop (API v2) — pulls recovery, sleep, and workout collections.
 *
 * Recovery scores get revised after a draw, so recovery is `replace`d each sync
 * (the file is always the current truth). Sleep and workouts are immutable once
 * recorded, so they `insert` and advance an `updated_at` cursor — only rows
 * newer than the last sync are pulled.
 */
const BASE = "https://api.prod.whoop.com/developer/v2";

interface Page<T> {
  records: T[];
  next_token?: string;
}

interface RecoveryRecord {
  cycle_id: number;
  sleep_id: string;
  created_at: string;
  updated_at: string;
  score?: { recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number };
}

interface SleepRecord {
  id: string;
  start: string;
  end: string;
  updated_at: string;
  score?: {
    sleep_performance_percentage?: number;
    sleep_efficiency_percentage?: number;
    stage_summary?: { total_in_bed_time_milli?: number; total_slow_wave_sleep_time_milli?: number; total_rem_sleep_time_milli?: number };
  };
}

interface WorkoutRecord {
  id: string;
  start: string;
  end: string;
  sport_name?: string;
  updated_at: string;
  score?: { strain?: number; average_heart_rate?: number; max_heart_rate?: number; kilojoule?: number };
}

const config = z.object({
  lookbackDays: z.number().int().positive().default(30).describe("how far back to pull on a first sync"),
});


function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function msToMinutes(ms: number | undefined): number | null {
  return typeof ms === "number" ? Math.round(ms / 60000) : null;
}

function latestUpdatedAt(records: { updated_at: string }[], fallback: string): string {
  return records.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), fallback);
}

async function fetchAll<T>(
  accessToken: string,
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const records: T[] = [];
  let nextToken: string | undefined;
  do {
    const url = new URL(`${BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("limit", "25");
    if (nextToken) url.searchParams.set("nextToken", nextToken);

    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Whoop ${path} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as Page<T>;
    records.push(...page.records);
    nextToken = page.next_token;
  } while (nextToken);
  return records;
}

export default defineConnector({
  description: "Whoop recovery, sleep, and workouts (API v2)",
  config,
  schedule: "6h",
  auth: {
    type: "oauth2",
    data: {
      authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
      tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
      scopes: ["read:recovery", "read:sleep", "read:workout", "offline"],
      clientIdEnv: "WHOOP_CLIENT_ID",
      clientSecretEnv: "WHOOP_CLIENT_SECRET",
    },
  },
  outputs: {
    recovery: { description: "daily recovery score, RHR, HRV — replaced each sync since scores get revised" },
    sleep: { description: "per-sleep performance + stage durations — inserted by updated_at cursor" },
    workouts: { description: "per-workout strain + heart rate — inserted by updated_at cursor" },
  },
  async sync(ctx) {
    const token = ctx.tokens!.accessToken;
    const start = isoDaysAgo(ctx.config.lookbackDays);

    const recovery = await fetchAll<RecoveryRecord>(token, "/recovery", { start });
    const recoveryRows = recovery.map((r) => ({
      cycle_id: r.cycle_id,
      sleep_id: r.sleep_id,
      date: r.created_at.slice(0, 10),
      recovery_score: r.score?.recovery_score ?? null,
      resting_heart_rate: r.score?.resting_heart_rate ?? null,
      hrv_ms: r.score?.hrv_rmssd_milli ?? null,
      updated_at: r.updated_at,
    }));
    await ctx.replace("recovery", recoveryRows);

    const sleepSince = typeof ctx.state.sleepCursor === "string" ? ctx.state.sleepCursor : start;
    const sleep = await fetchAll<SleepRecord>(token, "/activity/sleep", { start: sleepSince });
    const freshSleep = sleep.filter((s) => s.updated_at > sleepSince);
    if (freshSleep.length > 0) {
      await ctx.insert(
        "sleep",
        freshSleep.map((s) => ({
          sleep_id: s.id,
          start: s.start,
          end: s.end,
          performance_pct: s.score?.sleep_performance_percentage ?? null,
          efficiency_pct: s.score?.sleep_efficiency_percentage ?? null,
          in_bed_min: msToMinutes(s.score?.stage_summary?.total_in_bed_time_milli),
          deep_min: msToMinutes(s.score?.stage_summary?.total_slow_wave_sleep_time_milli),
          rem_min: msToMinutes(s.score?.stage_summary?.total_rem_sleep_time_milli),
          updated_at: s.updated_at,
        })),
      );
      ctx.state.sleepCursor = latestUpdatedAt(freshSleep, sleepSince);
    }

    const workoutSince = typeof ctx.state.workoutCursor === "string" ? ctx.state.workoutCursor : start;
    const workouts = await fetchAll<WorkoutRecord>(token, "/activity/workout", { start: workoutSince });
    const freshWorkouts = workouts.filter((w) => w.updated_at > workoutSince);
    if (freshWorkouts.length > 0) {
      await ctx.insert(
        "workouts",
        freshWorkouts.map((w) => ({
          workout_id: w.id,
          start: w.start,
          end: w.end,
          sport: w.sport_name ?? "unknown",
          strain: w.score?.strain ?? null,
          avg_hr: w.score?.average_heart_rate ?? null,
          max_hr: w.score?.max_heart_rate ?? null,
          kilojoules: w.score?.kilojoule ?? null,
          updated_at: w.updated_at,
        })),
      );
      ctx.state.workoutCursor = latestUpdatedAt(freshWorkouts, workoutSince);
    }

    ctx.log(`synced ${recoveryRows.length} recovery, ${freshSleep.length} sleep, ${freshWorkouts.length} workouts`);
  },
});
