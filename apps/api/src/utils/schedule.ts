/**
 * Returns the next reminder date for a patient enrollment, preserving the
 * original cadence relative to the previously scheduled date.
 *
 * Avoids cron-drift: if the server was offline (Render free cold start, deploy,
 * outage), naive `today + freq` shifts every patient's schedule forward by the
 * downtime. This advances from `originalDate + freq` and keeps adding `freq`
 * until the next date is in the future, recovering the original cadence.
 *
 * @param originalDate - The date the reminder was previously scheduled for
 * @param freqDays - Program frequency in days (e.g. 30 for monthly)
 * @param today - The reference "today" (UTC midnight)
 */
export function advanceNextReminderDate(
  originalDate: Date,
  freqDays: number,
  today: Date
): Date {
  if (freqDays < 1) {
    throw new Error(`advanceNextReminderDate: freqDays must be >= 1, got ${freqDays}`);
  }

  const next = new Date(originalDate);
  // Use a hard ceiling so a corrupted originalDate (e.g. year 1900) doesn't
  // loop millions of times. 10 years of cycles is more than enough for any
  // real overdue scenario.
  const MAX_ITERATIONS = Math.ceil((10 * 365) / freqDays) + 2;
  let iterations = 0;

  do {
    next.setUTCDate(next.getUTCDate() + freqDays);
    iterations++;
    if (iterations > MAX_ITERATIONS) {
      throw new Error(
        `advanceNextReminderDate: too many iterations (${iterations}) — likely corrupted originalDate ${originalDate.toISOString()}`
      );
    }
  } while (next <= today);

  return next;
}
