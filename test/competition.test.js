'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bracketRoundName,
  bracketSeedPositions,
  buildGroupStandings,
  competitionRoundName,
  selectQualifiers
} = require('../lib/competition');

test('builds group tables from finished scores using 3-1-0 points', () => {
  const groups = buildGroupStandings([
    { phase: 'group', group_name: 'A', home_team: 'Alpha', away_team: 'Beta', home_score: 2, away_score: 0, status: 'Selesai' },
    { phase: 'group', group_name: 'A', home_team: 'Beta', away_team: 'Gamma', home_score: 1, away_score: 1, status: 'Selesai' },
    { phase: 'group', group_name: 'A', home_team: 'Alpha', away_team: 'Gamma', home_score: null, away_score: null, status: 'Terjadwal' }
  ]);
  assert.deepEqual(groups[0].teams.map(team => [team.team, team.played, team.points, team.goal_difference]), [
    ['Alpha', 1, 3, 2],
    ['Gamma', 1, 1, 0],
    ['Beta', 2, 1, -2]
  ]);
});

test('ranks tied points by goal difference and goals scored', () => {
  const [group] = buildGroupStandings([
    { phase: 'group', group_name: 'A', home_team: 'Alpha', away_team: 'Beta', home_score: 2, away_score: 0, status: 'Selesai' },
    { phase: 'group', group_name: 'A', home_team: 'Beta', away_team: 'Gamma', home_score: 1, away_score: 0, status: 'Selesai' },
    { phase: 'group', group_name: 'A', home_team: 'Gamma', away_team: 'Alpha', home_score: 1, away_score: 0, status: 'Selesai' }
  ]);
  assert.deepEqual(group.teams.map(team => team.team), ['Alpha', 'Gamma', 'Beta']);
});

test('uses goals scored after points and goal difference are equal', () => {
  const [group] = buildGroupStandings([
    { phase: 'group', group_name: 'A', home_team: 'Alpha', away_team: 'Beta', home_score: 2, away_score: 1, status: 'Selesai' },
    { phase: 'group', group_name: 'A', home_team: 'Beta', away_team: 'Gamma', home_score: 3, away_score: 2, status: 'Selesai' },
    { phase: 'group', group_name: 'A', home_team: 'Gamma', away_team: 'Alpha', home_score: 4, away_score: 3, status: 'Selesai' }
  ]);
  assert.deepEqual(group.teams.map(team => [team.team, team.points, team.goal_difference]), [
    ['Gamma', 3, 0],
    ['Alpha', 3, 0],
    ['Beta', 3, 0]
  ]);
});

test('combines league-format fixtures into one table and ranks the special formats', () => {
  const groups = buildGroupStandings([
    { phase: 'group', group_name: 'A', home_team: 'Pelajar 01', away_team: 'Pelajar 02', home_score: 1, away_score: 0, status: 'Selesai' },
    { phase: 'group', group_name: 'B', home_team: 'Pelajar 03', away_team: 'Pelajar 04', home_score: 0, away_score: 1, status: 'Selesai' }
  ], { unified: true });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'Liga');
  assert.deepEqual(groups[0].teams.map(team => team.team), ['Pelajar 01', 'Pelajar 04', 'Pelajar 02', 'Pelajar 03']);
  assert.deepEqual(selectQualifiers(groups, 'community_shield').map(team => team.group_rank), [1, 2, 3, 4]);
  assert.deepEqual(selectQualifiers(groups, 'student_24').map(team => team.team), groups[0].teams.map(team => team.team));
});

test('selects group winners, both top teams, or a configured number of best runners-up', () => {
  const groups = buildGroupStandings([
    { phase: 'group', group_name: 'A', home_team: 'A1', away_team: 'A2', home_score: 2, away_score: 0, status: 'Selesai' },
    { phase: 'group', group_name: 'B', home_team: 'B1', away_team: 'B2', home_score: 1, away_score: 0, status: 'Selesai' }
  ]);
  assert.equal(selectQualifiers(groups, 'group_winners').length, 2);
  assert.equal(selectQualifiers(groups, 'top_two').length, 4);
  assert.deepEqual(selectQualifiers(groups, 'best_runners_up', 1).map(team => team.team), ['A1', 'B1', 'B2']);
});

test('creates balanced seeded bracket positions and round labels', () => {
  assert.deepEqual(bracketSeedPositions(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.equal(bracketRoundName(8, 0), 'Perempat Final');
  assert.equal(bracketRoundName(8, 2), 'Final');
  assert.equal(competitionRoundName('student_24', 24, 0), 'Playoff');
  assert.equal(competitionRoundName('student_24', 24, 2), 'Perempat Final');
});
