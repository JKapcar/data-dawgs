import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function firstKickoffs(schedule, season) {
  const weeks = new Map();
  for (const g of schedule.filter(g => g.season === season && g.season_type === 'REG')) {
    const kick = Date.parse(g.kickoff_at);
    if (!Number.isFinite(kick)) throw new Error(`Invalid kickoff: ${g.game_id}`);
    weeks.set(g.week, Math.min(weeks.get(g.week) ?? Infinity, kick));
  }
  if (weeks.size !== 18) throw new Error(`Expected 18 regular-season weeks, got ${weeks.size}`);
  return weeks;
}

export function captureGate(schedule, season, now = Date.now()) {
  const next = [...firstKickoffs(schedule, season)].filter(([, kick]) => kick > now)
    .sort((a, b) => a[1] - b[1])[0];
  const hours = next ? (next[1] - now) / 36e5 : null;
  return { week: next?.[0] ?? '', hours, capture: hours !== null && hours > 0 && hours <= 24 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { data } = JSON.parse(fs.readFileSync('data/nfl-schedule.json'));
  const override = process.env.CAPTURE_WEEK || '';
  if (override && !/^(?:[1-9]|1[0-8])$/.test(override)) throw new Error('Invalid week override');
  const g = captureGate(data.games, data.season);
  console.log(`week=${override || g.week}\nhours_to_kickoff=${override ? 'override' : g.hours?.toFixed(1) ?? ''}\ncapture=${override ? true : g.capture}`);
}
