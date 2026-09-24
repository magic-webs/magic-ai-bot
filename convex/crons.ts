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

/* Same fifteen-minute cadence as the review sweep, against the same
   sixty-minute threshold: a thread a colleague abandoned goes back to the
   agent roughly 60–75 minutes after their last reply. Erring late is the right
   way round — handing a thread back while someone is still typing on it is the
   failure that matters. */
crons.interval(
  "hand back abandoned takeovers",
  { minutes: 15 },
  internal.conversations.releaseDormantTakeovers,
  {}
);

/* Calendar entries are set to the hour, so five minutes is the most a festival
   greeting goes out late — and a sweep with nothing due reads one index range. */
crons.interval(
  "send due marketing events",
  { minutes: 5 },
  internal.marketing.claimDueEvents,
  {}
);

/* Hourly, against each workspace's own clock: a workspace in Kolkata and one
   in London both wish at nine their time. `lastBirthdayRun` makes it once a
   day however many times this fires after the hour. */
crons.interval(
  "send birthday wishes",
  { hours: 1 },
  internal.marketing.claimBirthdays,
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
