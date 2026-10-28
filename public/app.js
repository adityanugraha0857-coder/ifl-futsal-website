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
  const fallbackData = {
    events: [
      { id: 1, title: 'IFL Open Cup', category: 'Turnamen', location: 'Pontianak', start_date: '2026-11-08', end_date: '2026-11-09', status: 'Akan Datang', description: 'Kompetisi futsal komunitas dan klub lokal dengan format grup dan babak final.' },
      { id: 2, title: 'Fafage Academy Showcase', category: 'Academy', location: 'Pontianak', start_date: '2026-11-15', end_date: '2026-11-15', status: 'Akan Datang', description: 'Acara pembinaan skill, latihan terbuka, dan uji kemampuan pemain muda.' }
    ],
    matches: [
      { id: 1, match_date: '2026-11-08', match_time: '18:00', home_team: 'Borneo FC', away_team: 'Pontianak United', home_score: null, away_score: null, venue: 'Lapangan IFL Arena', status: 'Terjadwal', round_name: 'Babak Grup A', event_title: 'IFL Open Cup' },
      { id: 2, match_date: '2026-11-08', match_time: '20:00', home_team: 'Khatulistiwa XI', away_team: 'Fafage Academy', home_score: null, away_score: null, venue: 'Lapangan IFL Arena', status: 'Terjadwal', round_name: 'Babak Grup B', event_title: 'IFL Open Cup' },
      { id: 3, match_date: '2026-11-01', match_time: '19:00', home_team: 'IFL All Stars', away_team: 'Pontianak City', home_score: 4, away_score: 2, venue: 'Lapangan Fafage', status: 'Selesai', round_name: 'Semifinal', event_title: 'IFL Open Cup' }
    ],
    settings: {
      contact_name: 'Panitia IFL Event',
      contact_phone: '6281234567890',
      contact_email: 'ifl.event@gmail.com',
      venue: 'Pontianak, Kalimantan Barat',
      about: 'IFL Event menghadirkan kompetisi futsal, kegiatan komunitas, expo, dan seminar. Bersama Fafage Academy Pontianak, kami mendukung perkembangan talenta futsal dan semangat sportivitas.'
    }
  };
  const state = { events: [], matches: [], settings: {} };

  function eventCard(e) {
    const start = formatDate(e.start_date);
    const dateText = e.end_date && e.end_date !== e.start_date ? `${start} — ${formatDate(e.end_date)}` : start;
    return `<article class="event-card">
      <div class="event-meta"><span>${escapeHtml(e.category || 'Turnamen')}</span><span class="status-pill">${escapeHtml(e.status || 'Akan Datang')}</span></div>
      <h3>${escapeHtml(e.title)}</h3><p>${escapeHtml(e.description || 'Pantau informasi terbaru event ini melalui kanal resmi IFL Event.')}</p>
      <div class="event-foot"><span>⌖ ${escapeHtml(e.location || 'Pontianak')}<br>${escapeHtml(dateText)}</span><strong>↗</strong></div>
      ${(e.categories||[]).length?`<div class="event-category-list">${e.categories.map(category=>`<span>${escapeHtml(category)}</span>`).join('')}</div>`:''}
      <a class="event-schedule-btn" href="/event/${encodeURIComponent(e.id)}">LIHAT JADWAL <span>↗</span></a>
    </article>`;
  }
  function render() {
    const eventGrid = $('#eventGrid');
    const upcoming = [...state.events].sort((a,b) => a.start_date.localeCompare(b.start_date));
    eventGrid.innerHTML = upcoming.length ? upcoming.map(eventCard).join('') : '<div class="empty-state">Belum ada event yang dipublikasikan. Silakan cek kembali nanti.</div>';
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
      console.warn('Menggunakan data demo GitHub Pages.', error);
      Object.assign(state, fallbackData);
      render();
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
  $('#year').textContent = new Date().getFullYear();
  load();
})();