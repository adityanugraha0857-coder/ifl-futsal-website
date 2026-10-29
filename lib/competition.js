'use strict';

function isFinished(match) {
  return String(match.status || '').toLocaleLowerCase('id-ID') === 'selesai' &&
    Number.isInteger(Number(match.home_score)) &&
    Number.isInteger(Number(match.away_score)) &&
    match.home_score !== null &&
    match.away_score !== null;
}

function compareRows(a, b) {
  return b.points - a.points ||
    (b.goals_for - b.goals_against) - (a.goals_for - a.goals_against) ||
    b.goals_for - a.goals_for ||
    a.team.localeCompare(b.team, 'id');
}

function buildGroupStandings(matches, { unified = false } = {}) {
  const groups = new Map();
  for (const match of matches) {
    const group = unified ? 'Liga' : String(match.group_name || '').trim() || 'Liga';
    if (match.phase !== 'group') continue;
    if (!groups.has(group)) groups.set(group, new Map());
    const table = groups.get(group);
    for (const side of ['home', 'away']) {
      const team = String(match[`${side}_team`] || '').trim();
      if (!team) continue;
      const key = team.toLocaleLowerCase('id-ID');
      if (!table.has(key)) {
        table.set(key, {
          team,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goals_for: 0,
          goals_against: 0,
          goal_difference: 0,
          points: 0
        });
      }
    }
    if (!isFinished(match)) continue;
    const home = table.get(String(match.home_team).trim().toLocaleLowerCase('id-ID'));
    const away = table.get(String(match.away_team).trim().toLocaleLowerCase('id-ID'));
    if (!home || !away) continue;
    const homeGoals = Number(match.home_score);
    const awayGoals = Number(match.away_score);
    home.played++;
    away.played++;
    home.goals_for += homeGoals;
    home.goals_against += awayGoals;
    away.goals_for += awayGoals;
    away.goals_against += homeGoals;
    if (homeGoals > awayGoals) {
      home.wins++;
      home.points += 3;
      away.losses++;
    } else if (homeGoals < awayGoals) {
      away.wins++;
      away.points += 3;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
      home.points++;
      away.points++;
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'id'))
    .map(([name, teams]) => ({
      name,
      teams: [...teams.values()]
        .map(team => ({
          ...team,
          goal_difference: team.goals_for - team.goals_against
        }))
        .sort(compareRows)
    }));
}

function compareQualified(a, b) {
  return compareRows(
    { ...a, goals_against: a.goals_for - a.goal_difference },
    { ...b, goals_against: b.goals_for - b.goal_difference }
  );
}

function selectQualifiers(groups, mode, bestRunnerUpCount = 0) {
  const leagueTeams = groups[0]?.teams || [];
  if (mode === 'student_24') {
    return leagueTeams.map((team, index) => ({ ...team, group: 'Liga', group_rank: index + 1 }));
  }
  if (mode === 'community_shield') {
    return leagueTeams.slice(0, 8).map((team, index) => ({ ...team, group: 'Liga', group_rank: index + 1 }));
  }
  const winners = groups.filter(group => group.teams.length).map(group => ({
    ...group.teams[0],
    group: group.name,
    group_rank: 1
  }));
  if (mode === 'group_winners') return winners.sort(compareQualified);

  const runnersUp = groups.filter(group => group.teams.length > 1).map(group => ({
    ...group.teams[1],
    group: group.name,
    group_rank: 2
  })).sort(compareQualified);

  if (mode === 'top_two') return [...winners, ...runnersUp].sort((a, b) =>
    a.group_rank - b.group_rank || compareQualified(a, b)
  );
  if (mode === 'best_runners_up') {
    const count = Math.max(0, Math.min(Number(bestRunnerUpCount) || 0, runnersUp.length));
    return [...winners, ...runnersUp.slice(0, count)].sort((a, b) =>
      a.group_rank - b.group_rank || compareQualified(a, b)
    );
  }
  return [];
}

function bracketSize(teamCount) {
  let size = 1;
  while (size < teamCount) size *= 2;
  return size;
}

function bracketSeedPositions(size) {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new Error('Ukuran bagan harus berupa pangkat dua minimal 2.');
  }
  let positions = [1, 2];
  while (positions.length < size) {
    const nextSeed = positions.length * 2 + 1;
    positions = positions.flatMap(seed => [seed, nextSeed - seed]);
  }
  return positions;
}

function bracketRoundName(teamCount, roundIndex) {
  const remainingTeams = bracketSize(teamCount) / (2 ** roundIndex);
  if (remainingTeams === 2) return 'Final';
  if (remainingTeams === 4) return 'Semifinal';
  if (remainingTeams === 8) return 'Perempat Final';
  return `Babak ${remainingTeams}`;
}

function competitionRoundName(format, teamCount, roundIndex) {
  if (format === 'student_24') {
    return ['Playoff', 'Babak 16 Besar', 'Perempat Final', 'Semifinal', 'Final'][roundIndex] ||
      bracketRoundName(teamCount, roundIndex);
  }
  return bracketRoundName(teamCount, roundIndex);
}

module.exports = {
  bracketRoundName,
  bracketSeedPositions,
  bracketSize,
  buildGroupStandings,
  competitionRoundName,
  isFinished,
  selectQualifiers
};
