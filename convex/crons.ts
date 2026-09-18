/**
 * Scheduled work.
 *
 * The sweep runs every fifteen minutes against a sixty-minute dormancy
 * threshold, so a review lands roughly 60–75 minutes after the customer's last
 * message. Running it on the threshold itself would mean a thread that went
 * quiet at 10:59 waited until 12:00.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "review dormant conversations",
  { minutes: 15 },
  internal.followUp.sweep,
  {}
);

// Was written when sessions were added and never scheduled, so expired rows
// have been accumulating. Nightly is often enough for a thirty-day token.
crons.daily(
  "purge expired sessions",
  { hourUTC: 3, minuteUTC: 20 },
  internal.auth.purgeExpiredSessions,
  {}
);

// A consent screen somebody opened and abandoned leaves a state row behind.
// They expire after fifteen minutes and are consumed on use, so this is only
// housekeeping — hourly is plenty.
crons.interval(
  "sweep abandoned oauth handshakes",
  { hours: 1 },
  internal.integrations.sweepStates,
  {}
);

export default crons;
