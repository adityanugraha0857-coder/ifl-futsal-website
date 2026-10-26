(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const formatDate = value => {
    if (!value) return 'Tanggal menyusul';
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('id-ID', { day:'2-digit', month:'short', year:'numeric' }).format(d);
  };
  const state = { events: [], matches: [], settings: {}, filter: 'all' };

  function eventCard(e) {
    const start = formatDate(e.start_date);
    const dateText = e.end_date && e.end_date !== e.start_date ? `${start} — ${formatDate(e.end_date)}` : start;
    return `<article class="event-card">
      <div class="event-meta"><span>${escapeHtml(e.category || 'Turnamen')}</span><span class="status-pill">${escapeHtml(e.status || 'Akan Datang')}</span></div>
      <h3>${escapeHtml(e.title)}</h3><p>${escapeHtml(e.description || 'Pantau informasi terbaru event ini melalui kanal resmi IFL Event.')}</p>
      <div class="event-foot"><span>⌖ ${escapeHtml(e.location || 'Pontianak')}<br>${escapeHtml(dateText)}</span><strong>↗</strong></div>
    </article>`;
  }
  function matchRow(m) {
    const hasScore = m.home_score !== null && m.home_score !== undefined && m.away_score !== null && m.away_score !== undefined;
    const score = hasScore ? `${Number(m.home_score)} <span class="versus">:</span> ${Number(m.away_score)}` : '<span class="versus">VS</span>';
    return `<article class="match-row">
      <div class="match-date"><strong>${escapeHtml(formatDate(m.match_date))}</strong><span>${escapeHtml(m.match_time || 'Waktu menyusul')}</span></div>
      <div><div class="match-main"><div class="team">${escapeHtml(m.home_team)}</div><div class="score">${score}</div><div class="team">${escapeHtml(m.away_team)}</div></div>
      <div class="match-details">${escapeHtml(m.event_title || m.round_name || 'Pertandingan')} ${m.venue ? `· ${escapeHtml(m.venue)}` : ''}</div></div>
      <div class="match-state">${escapeHtml(m.status || (hasScore ? 'Selesai' : 'Terjadwal'))}<small>${escapeHtml(m.round_name || '')}</small></div>
    </article>`;
  }
  function resultCard(m) {
    return `<article class="result-card"><div class="result-head"><span>${escapeHtml(formatDate(m.match_date))}</span><b>FULL TIME</b></div>
      <div class="result-teams"><div class="result-team">${escapeHtml(m.home_team)}</div><div class="result-score">${Number(m.home_score)} : ${Number(m.away_score)}</div><div class="result-team">${escapeHtml(m.away_team)}</div></div>
      <div class="result-location"><span>${escapeHtml(m.event_title || m.round_name || 'Pertandingan')}</span><span>${escapeHtml(m.venue || 'Pontianak')}</span></div></article>`;
  }
  function render() {
    const eventGrid = $('#eventGrid');
    const upcoming = [...state.events].sort((a,b) => a.start_date.localeCompare(b.start_date));
    eventGrid.innerHTML = upcoming.length ? upcoming.map(eventCard).join('') : '<div class="empty-state">Belum ada event yang dipublikasikan. Silakan cek kembali nanti.</div>';
    const filtered = [...state.matches].filter(m => state.filter === 'all' || (state.filter === 'Selesai' ? m.status === 'Selesai' : m.status !== 'Selesai')).sort((a,b) => (a.match_date+a.match_time).localeCompare(b.match_date+b.match_time));
    $('#matchList').innerHTML = filtered.length ? filtered.map(matchRow).join('') : '<div class="empty-state">Belum ada pertandingan untuk filter ini.</div>';
    const results = state.matches.filter(m => m.home_score !== null && m.home_score !== undefined && m.away_score !== null && m.away_score !== undefined).sort((a,b) => (b.match_date+b.match_time).localeCompare(a.match_date+a.match_time)).slice(0,3);
    $('#resultsGrid').innerHTML = results.length ? results.map(resultCard).join('') : '<div class="empty-state">Hasil pertandingan akan tampil di sini setelah skor diperbarui oleh panitia.</div>';
    const s = state.settings;
    $('#contactName').textContent = s.contact_name || 'Panitia IFL Event';
    $('#contactVenue').textContent = s.venue || 'Pontianak, Kalimantan Barat';
    $('#contactPhone').textContent = s.contact_phone || 'Nomor kontak diatur admin';
    const digits = String(s.contact_phone || '').replace(/[^\d+]/g, '');
    $('#phoneLink').href = digits ? `https://wa.me/${digits.replace(/^\+/, '')}` : '#kontak';
    $('#contactEmail').textContent = s.contact_email || 'Belum diatur';
    $('#emailLink').href = s.contact_email ? `mailto:${encodeURIComponent(s.contact_email)}` : '#kontak';
    $('#aboutText').textContent = s.about || 'IFL Event menghadirkan kompetisi futsal dan kegiatan komunitas bersama Fafage Academy Pontianak.';
  }
  async function load() {
    try {
      const response = await fetch('/api/public', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Gagal memuat data.');
      Object.assign(state, await response.json());
      render();
    } catch (error) {
      ['#eventGrid','#matchList','#resultsGrid'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = '<div class="empty-state">Data belum dapat dimuat. Pastikan server website sedang berjalan, lalu muat ulang halaman.</div>'; });
      console.error(error);
    }
  }
  $('#menuToggle')?.addEventListener('click', () => {
    const nav = $('#mainNav');
    const open = nav.classList.toggle('open');
    $('#menuToggle').setAttribute('aria-expanded', String(open));
  });
  $$('#mainNav a').forEach(a => a.addEventListener('click', () => {
    $('#mainNav').classList.remove('open');
    $('#menuToggle')?.setAttribute('aria-expanded', 'false');
  }));
  $$('.filter').forEach(btn => btn.addEventListener('click', () => {
    state.filter = btn.dataset.filter;
    $$('.filter').forEach(b => b.classList.toggle('active', b === btn));
    render();
  }));
  $('#year').textContent = new Date().getFullYear();
  load();
})();