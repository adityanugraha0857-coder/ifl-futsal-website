(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const formatDate = value => {
    if (!value) return 'Tanggal menyusul';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { day:'2-digit', month:'short', year:'numeric' }).format(date);
  };
  const eventId = location.pathname.split('/').filter(Boolean).at(-1);
  let eventCategories = [];
  let matches = [];
  let selectedCategory = '';

  function teamIdentity(team, logo) {
    const initials = String(team || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toLocaleUpperCase('id-ID');
    return `<span class="team-identity"><span class="team-mark">${escapeHtml(initials)}${logo ? `<img class="team-logo" src="/team-logos/${encodeURIComponent(logo)}" alt="" aria-hidden="true">` : ''}</span><span>${escapeHtml(team)}</span></span>`;
  }
  function rosterSide(team, players = [], officials = []) {
    const playerList = players.length
      ? `<ul>${players.map(player => `<li>${player.number == null ? '' : `<b>#${escapeHtml(player.number)}</b> `}${escapeHtml(player.name)}${player.position ? `<small>${escapeHtml(player.position)}</small>` : ''}</li>`).join('')}</ul>`
      : '<p class="roster-empty">Belum ada data pemain.</p>';
    const officialList = officials.length
      ? `<ul>${officials.map(official => `<li>${escapeHtml(official.name)}<small>${escapeHtml(official.role)}</small></li>`).join('')}</ul>`
      : '<p class="roster-empty">Belum ada data ofisial.</p>';
    return `<section class="roster-side"><h4>${escapeHtml(team)}</h4><div class="roster-columns"><div><b>PEMAIN</b>${playerList}</div><div><b>OFISIAL</b>${officialList}</div></div></section>`;
  }
  function matchCard(match) {
    const hasScore = match.home_score !== null && match.home_score !== undefined && match.away_score !== null && match.away_score !== undefined;
    const score = hasScore ? `${Number(match.home_score)} <span class="versus">:</span> ${Number(match.away_score)}` : '<span class="versus">VS</span>';
    const homePlayers = match.lineups?.home || [];
    const awayPlayers = match.lineups?.away || [];
    const homeOfficials = match.officials?.home || [];
    const awayOfficials = match.officials?.away || [];
    const hasRoster = homePlayers.length || awayPlayers.length || homeOfficials.length || awayOfficials.length;
    return `<article class="match-row">
      <div class="match-date"><strong>${escapeHtml(formatDate(match.match_date))}</strong><span>${escapeHtml(match.match_time || 'Waktu menyusul')}</span></div>
      <div><div class="match-main"><div class="team team-home">${teamIdentity(match.home_team,match.home_logo)}</div><div class="score">${score}</div><div class="team team-away">${teamIdentity(match.away_team,match.away_logo)}</div></div>
      <div class="match-details">${match.event_category ? `<b>${escapeHtml(match.event_category)}</b> · ` : ''}${escapeHtml(match.round_name || 'Pertandingan')} ${match.venue ? `· ${escapeHtml(match.venue)}` : ''}</div>
      ${hasRoster ? `<details class="match-roster-details"><summary>Lineup & ofisial tim</summary><div class="match-roster-grid">${rosterSide(match.home_team,homePlayers,homeOfficials)}${rosterSide(match.away_team,awayPlayers,awayOfficials)}</div></details>` : ''}</div>
      <div class="match-state">${escapeHtml(match.status || (hasScore ? 'Selesai' : 'Terjadwal'))}<small>${escapeHtml(match.round_name || '')}</small></div>
    </article>`;
  }
  function groupedMatches(items, renderCard, cardContainerClass, descending = false) {
    const days = new Map();
    items.forEach(match => {
      const date = match.match_date || '';
      const category = String(match.event_category || '').trim() || 'Kategori umum';
      if (!days.has(date)) days.set(date, new Map());
      const categories = days.get(date);
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push(match);
    });
    return [...days.entries()]
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB) * (descending ? -1 : 1))
      .map(([date, categories]) => `<section class="match-day-group">
        <h3 class="match-group-date">${escapeHtml(formatDate(date))}</h3>
        ${[...categories.entries()].sort(([categoryA], [categoryB]) => categoryA.localeCompare(categoryB, 'id'))
          .map(([category, grouped]) => `<section class="match-category-group">
            <h4 class="match-group-category">${escapeHtml(category)}</h4>
            <div class="${cardContainerClass}">${grouped.map(renderCard).join('')}</div>
          </section>`).join('')}
      </section>`).join('');
  }
  function render() {
    const filtered = matches.filter(match => !selectedCategory || match.event_category === selectedCategory)
      .sort((a,b) => (a.match_date+a.match_time).localeCompare(b.match_date+b.match_time));
    $('#matchSummary').textContent = `${filtered.length} pertandingan${selectedCategory ? ` · ${selectedCategory}` : ' · semua kategori'}`;
    $('#matchList').innerHTML = filtered.length
      ? groupedMatches(filtered, matchCard, 'match-category-matches')
      : '<div class="empty-state">Belum ada jadwal pertandingan pada kategori ini.</div>';
    $$('.team-logo').forEach(image => image.addEventListener('error', () => image.hidden = true, { once: true }));
  }
  function renderCategories() {
    const options = ['', ...eventCategories];
    $('#eventCategoryFilters').innerHTML = options.map(category => `<button class="filter${category === selectedCategory ? ' active' : ''}" type="button" data-category="${escapeHtml(category)}">${category ? escapeHtml(category) : 'Semua kategori'}</button>`).join('');
  }
  async function load() {
    if (!/^\d+$/.test(eventId || '')) {
      $('#eventTitle').textContent = 'Event tidak ditemukan';
      $('#eventDescription').textContent = 'ID event tidak valid.';
      $('#matchList').innerHTML = '';
      return;
    }
    try {
      const response = await fetch(`/api/public/events/${encodeURIComponent(eventId)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(response.status === 404 ? 'Event tidak ditemukan.' : 'Gagal memuat detail event.');
      const data = await response.json();
      const event = data.event;
      eventCategories = event.categories || [];
      matches = data.matches || [];
      $('#eventType').textContent = event.category || 'TURNAMEN';
      $('#eventTitle').textContent = event.title;
      $('#eventDescription').textContent = event.description || 'Ikuti jadwal dan hasil pertandingan resmi pada event ini.';
      const dates = event.end_date && event.end_date !== event.start_date
        ? `${formatDate(event.start_date)} — ${formatDate(event.end_date)}`
        : formatDate(event.start_date);
      $('#eventDates').textContent = `◷ ${dates}`;
      $('#eventLocation').textContent = `⌖ ${event.location || 'Pontianak'}`;
      $('#eventStatus').textContent = event.status || 'Akan Datang';
      document.title = `${event.title} — Jadwal & Hasil | IFL Event`;
      renderCategories();
      render();
    } catch (error) {
      $('#eventTitle').textContent = 'Event tidak tersedia';
      $('#eventDescription').textContent = error.message;
      $('#matchList').innerHTML = '<div class="empty-state">Silakan kembali ke daftar event.</div>';
    }
  }
  $('#eventCategoryFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    selectedCategory = button.dataset.category;
    renderCategories();
    render();
  });
  $('#year').textContent = new Date().getFullYear();
  load();
})();
