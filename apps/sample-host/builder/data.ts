/**
 * Stand-in for the tenant's own data services. Loaders reach them through ctx,
 * so the platform never sees odds, offers or other tenant data.
 */

export interface OddsRow {
  match: string;
  home: number;
  draw: number;
  away: number;
}

const ODDS: Record<string, OddsRow[]> = {
  epl: [
    { match: "Arsenal vs Chelsea", home: 2.1, draw: 3.4, away: 3.5 },
    { match: "Liverpool vs Everton", home: 1.6, draw: 4.0, away: 5.5 },
    { match: "Man City vs Spurs", home: 1.5, draw: 4.5, away: 6.0 },
    { match: "Newcastle vs Villa", home: 2.3, draw: 3.3, away: 3.1 },
    { match: "Brighton vs Fulham", home: 2.0, draw: 3.5, away: 3.7 },
    { match: "West Ham vs Wolves", home: 2.4, draw: 3.2, away: 3.0 },
  ],
  laliga: [
    { match: "Real Madrid vs Sevilla", home: 1.4, draw: 4.8, away: 7.5 },
    { match: "Barcelona vs Valencia", home: 1.5, draw: 4.4, away: 6.2 },
  ],
};

export const LEAGUES = [
  { value: "epl", label: "Premier League" },
  { value: "laliga", label: "La Liga" },
];

export const dataServices = {
  async odds(league: string, rows: number): Promise<OddsRow[]> {
    return (ODDS[league] ?? []).slice(0, rows);
  },
};

export type DataServices = typeof dataServices;
