(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const token = location.pathname.split('/').filter(Boolean).at(-1) || '';
  let previewUrl = '';

  const showError = message => {
    $('#registrationEventTitle').textContent = 'Link tidak tersedia';
    $('#registrationMessage').textContent = message;
    $('#registrationMessage').classList.add('error');
    $('#registrationForm').hidden = true;
  };

  async function loadEvent() {
    if (!/^[a-f0-9]{48}$/.test(token)) {
      showError('Link pendaftaran tidak valid.');
      return;
    }
    try {
      const response = await fetch(`/api/public/registrations/${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Link pendaftaran tidak ditemukan.');
      $('#registrationEventTitle').textContent = data.event.title;
      $('#registrationEventMeta').textContent = [data.event.location, data.event.start_date].filter(Boolean).join(' · ');
      document.title = `Daftar Tim — ${data.event.title} | IFL Event`;
    } catch (error) {
      showError(error.message);
    }
  }

  $('#teamLogo').addEventListener('change', () => {
    const file = $('#teamLogo').files[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    $('#logoPreview').hidden = !file;
    if (!file) return;
    previewUrl = URL.createObjectURL(file);
    $('#logoPreviewImage').src = previewUrl;
    $('#logoFileName').textContent = file.name;
  });

  $('#registrationForm').addEventListener('submit', async event => {
    event.preventDefault();
    const teamName = $('#teamName').value.trim();
    const logo = $('#teamLogo').files[0];
    const message = $('#registrationMessage');
    if (!teamName || !logo) return;
    if (logo.size > 1024 * 1024) {
      message.textContent = 'Ukuran logo maksimal 1 MB.';
      message.classList.add('error');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(logo.type)) {
      message.textContent = 'Gunakan logo PNG, JPG, atau WEBP.';
      message.classList.add('error');
      return;
    }
    const button = $('#submitRegistration');
    button.disabled = true;
    message.classList.remove('error');
    message.textContent = 'Mengirim pendaftaran...';
    try {
      const url = `/api/public/registrations/${encodeURIComponent(token)}?team_name=${encodeURIComponent(teamName)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': logo.type },
        body: logo
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Pendaftaran gagal dikirim.');
      $('#registrationForm').hidden = true;
      $('#registrationSuccess').hidden = false;
      $('#registrationMessage').textContent = '';
    } catch (error) {
      button.disabled = false;
      message.textContent = error.message;
      message.classList.add('error');
    }
  });

  $('#year').textContent = new Date().getFullYear();
  loadEvent();
})();
