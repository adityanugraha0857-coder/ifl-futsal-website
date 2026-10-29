(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const whatsappUrl = value => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return `https://wa.me/${digits.startsWith('0') ? `62${digits.slice(1)}` : digits}`;
  };
  const formatDate = value => {
    if (!value) return 'Tanggal menyusul';
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('id-ID', { day:'2-digit', month:'short', year:'numeric' }).format(d);
  };
  const fallbackData = {
    events: [],
    matches: [],
    settings: {
      contact_name: 'Panitia IFL Event',
      contact_phone: '',
      contact_phone_2: '',
      contact_email: '',
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
      ${location.hostname.endsWith('github.io') ? '' : `<a class="event-schedule-btn" href="/event/${encodeURIComponent(e.id)}">LIHAT JADWAL <span>↗</span></a>`}
    </article>`;
  }
  function render() {
    const eventGrid = $('#eventGrid');
    const upcoming = [...state.events].sort((a,b) => a.start_date.localeCompare(b.start_date));
    eventGrid.innerHTML = upcoming.length ? upcoming.map(eventCard).join('') : '<div class="empty-state">Data event dan jadwal real-time tersedia saat server aplikasi aktif.</div>';
    const s = state.settings;
    $('#contactName').textContent = s.contact_name || 'Panitia IFL Event';
    $('#contactVenue').textContent = s.venue || 'Pontianak, Kalimantan Barat';
    $('#contactPhone').textContent = s.contact_phone || 'Nomor kontak diatur admin';
    const phoneUrl = whatsappUrl(s.contact_phone);
    $('#phoneLink').href = phoneUrl || '#kontak';
    const phoneUrl2 = whatsappUrl(s.contact_phone_2);
    $('#contactPhone2').textContent = s.contact_phone_2 || 'Nomor kontak diatur admin';
    $('#phoneLink2').href = phoneUrl2 || '#kontak';
    $('#phoneLink2').hidden = !phoneUrl2;
    $('#contactEmail').textContent = s.contact_email || 'Belum diatur';
    $('#emailLink').href = s.contact_email ? `mailto:${encodeURIComponent(s.contact_email)}` : '#kontak';
    $('#aboutText').textContent = s.about || 'IFL Event menghadirkan kompetisi futsal dan kegiatan komunitas bersama Fafage Academy Pontianak.';
  }
  function load() {
    Object.assign(state, fallbackData);
    render();
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