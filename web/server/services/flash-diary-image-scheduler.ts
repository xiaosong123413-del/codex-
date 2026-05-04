/**
 * Schedules daily flash diary image generation at 23:30 local time.
 *
 * The job only touches today's diary markdown, and the generation service
 * itself decides whether the diary has enough text and whether an image is
 * already present.
 */

import type { ServerConfig } from "../config.js";
import { generateTodayFlashDiaryImage } from "./flash-diary-auto-image.js";

interface FlashDiaryImageScheduler {
  dispose(): void;
}

interface StartFlashDiaryImageSchedulerOptions {
  cfg: ServerConfig;
  run?: (now: Date) => void | Promise<void>;
}

const RUN_HOUR = 23;
const RUN_MINUTE = 30;

export function startFlashDiaryImageScheduler(
  options: StartFlashDiaryImageSchedulerOptions,
): FlashDiaryImageScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNextRun = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void runScheduledGeneration();
    }, millisecondsUntilNextLocalTime(new Date(), RUN_HOUR, RUN_MINUTE));
  };

  const runScheduledGeneration = async (): Promise<void> => {
    try {
      const now = new Date();
      const run = options.run ?? (async (date: Date): Promise<void> => {
        await generateTodayFlashDiaryImage(options.cfg.sourceVaultRoot, { now: date });
      });
      await run(now);
    } catch {
      // Keep the daily timer alive even if one image generation pass fails.
    } finally {
      scheduleNextRun();
    }
  };

  scheduleNextRun();

  return {
    dispose(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function millisecondsUntilNextLocalTime(
  now: Date,
  hour: number,
  minute: number,
): number {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return Math.max(1, next.getTime() - now.getTime());
}
