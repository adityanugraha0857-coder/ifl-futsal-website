'use strict';

const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');

const root = path.join(__dirname, '..');

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('stores group results, creates a bracket, and advances winners automatically', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifl-competition-test-'));
  const legacyDb = new Database(path.join(dataDir, 'ifl-events.sqlite'));
  legacyDb.exec(`CREATE TABLE competition_configs (
    event_id INTEGER NOT NULL,
    event_category TEXT NOT NULL,
    qualification_mode TEXT NOT NULL DEFAULT 'group_winners',
    best_runner_up_count INTEGER NOT NULL DEFAULT 0,
    group_stage_confirmed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, event_category)
  );
  CREATE TABLE participant_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    team_name TEXT NOT NULL,
    logo_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
  )`);
  legacyDb.close();
  const port = await unusedPort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-only-session-secret-with-more-than-32-characters',
      ADMIN_USERNAME: 'competition-test',
      ADMIN_PASSWORD: 'competition-test-password'
    },
    stdio: 'inherit'
  });
  let logs = '';
  child.on('error', error => { logs += `${error.message}\n`; });
  const baseUrl = `http://127.0.0.1:${port}`;
  let cookie = '';

  async function waitUntilReady() {
    const deadline = Date.now() + 10000;
    let lastStatus = 'no response';
    while (Date.now() < deadline) {
      if (child.exitCode !== null && child.exitCode !== undefined) throw new Error(`Test server exited unexpectedly on port ${port}:\n${logs}`);
      try {
        const response = await fetch(`${baseUrl}/api/session`);
        lastStatus = `HTTP ${response.status}`;
        if (response.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Test server did not start on port ${port} (${lastStatus}, pid ${child.pid}, exit ${child.exitCode}):\n${logs}`);
  }

  async function request(url, options = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.method && options.method !== 'GET' ? { Origin: baseUrl } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json();
    assert.equal(response.ok, true, payload.error || `HTTP ${response.status}`);
    return payload;
  }

  try {
    await waitUntilReady();
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ username: 'competition-test', password: 'competition-test-password' })
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';', 1)[0];

    await request('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        contact_phone: '6281111111111',
        contact_phone_2: '6282222222222'
      })
    });
    const publicSettings = await request('/api/public');
    assert.equal(publicSettings.settings.contact_phone, '6281111111111');
    assert.equal(publicSettings.settings.contact_phone_2, '6282222222222');

    const event = await request('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Turnamen',
        category: 'Turnamen',
        categories: ['Open'],
        start_date: '2026-10-29',
        end_date: '2026-10-31'
      })
    });
    const registrationLink = await request(`/api/admin/events/${event.id}/registration-link`, {
      method: 'PUT'
    });
    assert.match(registrationLink.token, /^[a-f0-9]{48}$/);
    const registrationPage = await fetch(`${baseUrl}/daftar/${registrationLink.token}`);
    assert.equal(registrationPage.status, 200);
    assert.match(await registrationPage.text(), /KIRIM PENDAFTARAN/);
    const registrationInfo = await request(`/api/public/registrations/${registrationLink.token}`);
    assert.equal(registrationInfo.event.title, 'Test Turnamen');
    assert.equal(Object.hasOwn(registrationInfo.event, 'registration_token'), false);

    const logo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=', 'base64');
    const submitRegistration = (teamName = 'Tim Pendaftar') => fetch(
      `${baseUrl}/api/public/registrations/${registrationLink.token}?team_name=${encodeURIComponent(teamName)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', Origin: baseUrl },
        body: logo
      }
    );
    const submitted = await submitRegistration();
    assert.equal(submitted.status, 201);
    const submittedRegistration = await submitted.json();
    assert.match(submittedRegistration.message, /menunggu persetujuan/);
    assert.equal(Object.hasOwn(submittedRegistration, 'roster_url'), false);
    assert.equal((await submitRegistration()).status, 400);
    const rejectedSubmission = await submitRegistration('Tim Ditolak');
    assert.equal(rejectedSubmission.status, 201);
    assert.equal((await fetch(`${baseUrl}/roster/${'a'.repeat(48)}`)).status, 404);

    let registrations = await request('/api/admin/data');
    const registration = registrations.participant_registrations.find(item => item.team_name === 'Tim Pendaftar');
    assert.equal(registration.status, 'pending');
    assert.equal(registrations.events.find(item => item.id === event.id).pending_registration_count, 2);
    const privateEventData = await request(`/api/public/events/${event.id}`);
    assert.equal(privateEventData.participants.length, 0);

    await request(`/api/admin/participant-registrations/${registration.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'approved' })
    });
    const rejectedRegistration = registrations.participant_registrations.find(item => item.team_name === 'Tim Ditolak');
    await request(`/api/admin/participant-registrations/${rejectedRegistration.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'rejected' })
    });
    const registrationsAfterRejection = await request('/api/admin/data');
    assert.ok(!registrationsAfterRejection.participant_registrations.some(item => item.id === rejectedRegistration.id));
    assert.equal((await fetch(`${baseUrl}/team-logos/${encodeURIComponent(rejectedRegistration.logo_name)}`)).status, 404);
    assert.equal(Object.hasOwn(registrationsAfterRejection, 'team_roster_submissions'), false);
    assert.equal((await fetch(`${baseUrl}/api/public/registrations/${registrationLink.token}`)).status, 200);
    const approvedEvent = await request(`/api/public/events/${event.id}`);
    assert.equal(approvedEvent.participants[0].name, 'Tim Pendaftar');

    const rosterMatch = await request('/api/admin/matches', {
      method: 'POST',
      body: JSON.stringify({
        event_id: event.id,
        event_category: 'Open',
        match_date: '2026-10-29',
        home_team: 'Tim Manual',
        away_team: 'Tim Pendaftar',
        phase: 'other'
      })
    });
    let adminDataWithRoster = await request('/api/admin/data');
    const rosterTeam = adminDataWithRoster.event_teams.find(team => team.team_name === 'Tim Pendaftar');
    assert.equal(rosterTeam.logo_name, registration.logo_name);
    let rosterMatchData = adminDataWithRoster.matches.find(match => match.id === rosterMatch.id);
    assert.equal(rosterMatchData.away_logo, registration.logo_name);
    assert.equal(rosterMatchData.home_logo, null);
    await request(`/api/admin/matches/${rosterMatch.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        event_id: event.id,
        event_category: 'Open',
        match_date: '2026-10-29',
        home_team: 'Tim Pendaftar',
        away_team: 'Tim Manual',
        phase: 'other'
      })
    });
    adminDataWithRoster = await request('/api/admin/data');
    rosterMatchData = adminDataWithRoster.matches.find(match => match.id === rosterMatch.id);
    assert.equal(rosterMatchData.home_logo, registration.logo_name);
    assert.equal(rosterMatchData.away_logo, null);

    const exportResponse = await fetch(`${baseUrl}/api/admin/events/${event.id}/participants/export`, {
      headers: { Cookie: cookie }
    });
    assert.equal(exportResponse.status, 200);
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
    assert.equal(exported.getWorksheet('Peserta').getRow(2).getCell(1).value, 'Tim Pendaftar');
    assert.equal(exported.getWorksheet('Peserta').getRow(3).getCell(1).value, null);
    assert.equal(exported.getWorksheet('Peserta').getImages().length, 1);
    await request(`/api/admin/participant-registrations/${registration.id}`, { method: 'DELETE' });
    const eventAfterTeamRemoval = await request(`/api/public/events/${event.id}`);
    assert.equal(eventAfterTeamRemoval.participants.length, 0);
    assert.ok((await request('/api/admin/data')).matches.some(match => match.id === rosterMatch.id));

    const importedEvent = await request('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Peserta Impor Test',
        category: 'Turnamen',
        categories: ['Open'],
        start_date: '2026-10-29',
        end_date: '2026-10-31'
      })
    });
    const participantWorkbook = new ExcelJS.Workbook();
    const participantSheet = participantWorkbook.addWorksheet('Data');
    participantSheet.addRow(['Nama Tim', 'Logo Tim']);
    participantSheet.addRow(['Tim Excel', '']);
    const participantImageId = participantWorkbook.addImage({ buffer: logo, extension: 'png' });
    participantSheet.addImage(participantImageId, { tl: { col: 1, row: 1 }, ext: { width: 48, height: 48 } });
    const participantWorkbookBuffer = Buffer.from(await participantWorkbook.xlsx.writeBuffer());
    const participantImportResponse = await fetch(
      `${baseUrl}/api/admin/events/${importedEvent.id}/participants/import`,
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: baseUrl,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        },
        body: participantWorkbookBuffer
      }
    );
    assert.equal(participantImportResponse.status, 200);
    const importedRosterMatch = await request('/api/admin/matches', {
      method: 'POST',
      body: JSON.stringify({
        event_id: importedEvent.id,
        event_category: 'Open',
        match_date: '2026-10-29',
        home_team: 'Tim Excel',
        away_team: 'Tim Manual',
        phase: 'other'
      })
    });
    const importedRosterData = await request('/api/admin/data');
    const importedTeam = importedRosterData.event_teams.find(team =>
      team.event_id === importedEvent.id && team.team_name === 'Tim Excel'
    );
    const importedMatch = importedRosterData.matches.find(match => match.id === importedRosterMatch.id);
    assert.ok(importedTeam?.logo_name);
    assert.equal(importedMatch.home_logo, importedTeam.logo_name);
    assert.equal(importedMatch.away_logo, null);

    const rotatedLink = await request(`/api/admin/events/${event.id}/registration-link`, { method: 'PUT' });
    const oldLinkInfo = await fetch(`${baseUrl}/api/public/registrations/${registrationLink.token}`);
    assert.equal(oldLinkInfo.status, 404);
    const revoked = await fetch(`${baseUrl}/api/admin/events/${event.id}/registration-link`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: baseUrl }
    });
    assert.equal(revoked.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/public/registrations/${rotatedLink.token}`)).status, 404);

    await request('/api/admin/competition-settings', {
      method: 'PUT',
      body: JSON.stringify({
        event_id: event.id,
        event_category: 'Open',
        qualification_mode: 'top_two',
        best_runner_up_count: 1
      })
    });

    async function addGroupMatch(group, home, away, homeScore, awayScore) {
      return request('/api/admin/matches', {
        method: 'POST',
        body: JSON.stringify({
          event_id: event.id,
          event_category: 'Open',
          match_date: '2026-10-29',
          home_team: home,
          away_team: away,
          home_score: homeScore,
          away_score: awayScore,
          status: 'Selesai',
          phase: 'group',
          group_name: group,
          round_name: `Grup ${group}`
        })
      });
    }

    await addGroupMatch('A', 'A1', 'A2', 2, 1);
    const finalGroupMatch = await addGroupMatch('B', 'B1', 'B2', 0, 1);
    const adminData = await request('/api/admin/data');
    assert.equal(adminData.competition_configs[0].qualification_mode, 'top_two');
    assert.equal(adminData.competition_configs[0].competition_format, 'groups');
    assert.deepEqual(adminData.matches.filter(match => match.phase === 'group').map(match => [match.phase, match.group_name, match.status, match.home_score, match.away_score]), [
      ['group', 'B', 'Selesai', 0, 1],
      ['group', 'A', 'Selesai', 2, 1]
    ]);
    assert.equal(finalGroupMatch.generated, false);
    const confirmed = await request('/api/admin/competition-settings', {
      method: 'PUT',
      body: JSON.stringify({
        event_id: event.id,
        event_category: 'Open',
        qualification_mode: 'top_two',
        best_runner_up_count: 1,
        group_stage_confirmed: true
      })
    });
    assert.equal(confirmed.generated, true);

    let data = await request(`/api/public/events/${event.id}`);
    assert.equal(data.standings.Open.find(group => group.name === 'A').teams[0].team, 'A1');
    let bracket = data.matches.filter(match => match.generated_bracket);
    assert.equal(bracket.length, 3);
    const semifinals = bracket.filter(match => match.bracket_round === 1);

    for (const [index, match] of semifinals.entries()) {
      const tied = index === 1;
      await request(`/api/admin/matches/${match.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          event_id: event.id,
          event_category: 'Open',
          match_date: '2026-10-30',
          home_team: match.home_team,
          away_team: match.away_team,
          home_score: tied ? 1 : 2,
          away_score: tied ? 1 : 0,
          home_penalty_score: tied ? 4 : '',
          away_penalty_score: tied ? 3 : '',
          venue: 'GOR Test',
          status: 'Selesai'
        })
      });
    }
    data = await request(`/api/public/events/${event.id}`);
    const final = data.matches.find(match => match.generated_bracket && match.bracket_round === 2);
    assert.equal(final.home_team, 'A1');
    assert.equal(final.away_team, 'B2');

    await request(`/api/admin/matches/${finalGroupMatch.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        event_id: event.id,
        event_category: 'Open',
        match_date: '2026-10-29',
        home_team: 'B1',
        away_team: 'B2',
        home_score: 2,
        away_score: 0,
        status: 'Selesai',
        phase: 'group',
        group_name: 'B',
        round_name: 'Grup B'
      })
    });
    data = await request(`/api/public/events/${event.id}`);
    bracket = data.matches.filter(match => match.generated_bracket);
    assert.ok(bracket.every(match => match.home_score === null && match.away_score === null));

    const formatEvent = await request('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Format Liga Test',
        category: 'Turnamen',
        categories: ['Pelajar', 'Community Shield'],
        start_date: '2026-10-29',
        end_date: '2026-10-31'
      })
    });
    async function setFormat(category, format, confirmed = false) {
      return request('/api/admin/competition-settings', {
        method: 'PUT',
        body: JSON.stringify({
          event_id: formatEvent.id,
          event_category: category,
          competition_format: format,
          qualification_mode: 'group_winners',
          best_runner_up_count: 0,
          group_stage_confirmed: confirmed
        })
      });
    }
    async function addLeagueMatch(category, home, away) {
      await request('/api/admin/matches', {
        method: 'POST',
        body: JSON.stringify({
          event_id: formatEvent.id,
          event_category: category,
          match_date: '2026-10-29',
          home_team: home,
          away_team: away,
          home_score: 0,
          away_score: 0,
          status: 'Selesai',
          phase: 'group'
        })
      });
    }

    const incompleteStudentBracket = await setFormat('Pelajar', 'student_24', true);
    assert.equal(incompleteStudentBracket.generated, false);
    assert.match(incompleteStudentBracket.warning, /semua hasil fase grup lengkap/);
    await setFormat('Pelajar', 'student_24');
    const studentTeams = Array.from({ length: 24 }, (_, index) => `Pelajar ${String(index + 1).padStart(2, '0')}`);
    let studentRotation = [...studentTeams];
    for (let round = 0; round < 3; round++) {
      for (let index = 0; index < studentRotation.length / 2; index++) {
        await addLeagueMatch('Pelajar', studentRotation[index], studentRotation[studentRotation.length - index - 1]);
      }
      studentRotation = [studentRotation[0], studentRotation[studentRotation.length - 1], ...studentRotation.slice(1, -1)];
    }
    const studentBracketResult = await setFormat('Pelajar', 'student_24', true);
    assert.equal(studentBracketResult.generated, true);
    data = await request(`/api/public/events/${formatEvent.id}`);
    assert.equal(data.standings.Pelajar.length, 1);
    assert.equal(data.standings.Pelajar[0].name, 'Liga');
    assert.equal(data.standings.Pelajar[0].teams.length, 24);
    assert.ok(data.standings.Pelajar[0].teams.every(team => team.played === 3));
    const studentBracket = data.matches.filter(match => match.generated_bracket && match.event_category === 'Pelajar');
    assert.deepEqual([1, 2, 3, 4, 5].map(round => studentBracket.filter(match => match.bracket_round === round).length), [8, 8, 4, 2, 1]);
    assert.equal(studentBracket.find(match => match.bracket_round === 1).round_name, 'Playoff');
    assert.equal(studentBracket.find(match => match.bracket_round === 2).round_name, 'Babak 16 Besar');
    const studentPlayoffPairs = studentBracket.filter(match => match.bracket_round === 1).map(match => [
      Number(match.home_team.match(/\d+$/)[0]),
      Number(match.away_team.match(/\d+$/)[0])
    ].sort((a, b) => a - b).join('-')).sort();
    assert.deepEqual(studentPlayoffPairs, ['9-24', '10-23', '11-22', '12-21', '13-20', '14-19', '15-18', '16-17'].sort());
    assert.ok(studentBracket.filter(match => match.bracket_round === 2).every(match =>
      [match.home_qualifier_seed, match.away_qualifier_seed].some(seed => seed >= 1 && seed <= 8)
    ));

    await setFormat('Community Shield', 'community_shield');
    const shieldTeams = Array.from({ length: 8 }, (_, index) => `Shield ${String(index + 1).padStart(2, '0')}`);
    let shieldRotation = [...shieldTeams];
    for (let round = 0; round < 7; round++) {
      for (let index = 0; index < shieldRotation.length / 2; index++) {
        await addLeagueMatch('Community Shield', shieldRotation[index], shieldRotation[shieldRotation.length - index - 1]);
      }
      shieldRotation = [shieldRotation[0], shieldRotation[shieldRotation.length - 1], ...shieldRotation.slice(1, -1)];
    }
    const shieldBracketResult = await setFormat('Community Shield', 'community_shield', true);
    assert.equal(shieldBracketResult.generated, true);
    data = await request(`/api/public/events/${formatEvent.id}`);
    assert.equal(data.standings['Community Shield'][0].teams.length, 8);
    const shieldBracket = data.matches.filter(match => match.generated_bracket && match.event_category === 'Community Shield');
    const shieldPairs = shieldBracket.filter(match => match.bracket_round === 1).map(match => [
      Number(match.home_team.match(/\d+$/)[0]),
      Number(match.away_team.match(/\d+$/)[0])
    ].sort((a, b) => a - b).join('-')).sort();
    assert.deepEqual(shieldPairs, ['1-8', '2-7', '3-6', '4-5']);

    const blankGroupEvent = await request('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Grup Tanpa Nama Test',
        category: 'Turnamen',
        categories: ['Open'],
        start_date: '2026-10-29'
      })
    });
    const blankGroupMatch = await request('/api/admin/matches', {
      method: 'POST',
      body: JSON.stringify({
        event_id: blankGroupEvent.id,
        event_category: 'Open',
        match_date: '2026-10-29',
        home_team: 'Tim Satu',
        away_team: 'Tim Dua',
        home_score: 2,
        away_score: 1,
        status: 'Selesai',
        phase: 'group',
        group_name: ''
      })
    });
    assert.ok(blankGroupMatch.id);
    const blankGroupData = await request(`/api/public/events/${blankGroupEvent.id}`);
    assert.equal(blankGroupData.standings.Open.length, 1);
    assert.equal(blankGroupData.standings.Open[0].name, 'Liga');
    assert.deepEqual(blankGroupData.standings.Open[0].teams.map(team => team.team), ['Tim Satu', 'Tim Dua']);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
