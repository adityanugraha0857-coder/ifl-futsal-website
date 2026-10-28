(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = v => { if(!v) return '—'; const d=new Date(`${v}T00:00:00`); return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(d); };
  const state = { events: [], matches: [], settings: {}, username: '' };
  const logoPreviewUrls = { home: '', away: '' };
  const msg = (id, text, error=false) => { const el=$(id); el.textContent=text; el.classList.toggle('error',error); };
  async function api(url, options={}) {
    const res = await fetch(url, { ...options, headers: { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) }, credentials:'same-origin' });
    let data={}; try { data=await res.json(); } catch {}
    if(!res.ok) { if(res.status===401 && url !== '/api/login') showLogin('Sesi berakhir. Silakan login kembali.'); throw new Error(data.error || 'Permintaan gagal.'); }
    return data;
  }
  const json = data => JSON.stringify(data);
  function showLogin(message='') {
    $('#loginView').style.display='block'; $('#dashboardView').style.display='none';
    if(message) msg('#loginMessage',message,true);
  }
  function showDashboard(username) {
    $('#loginView').style.display='none'; $('#dashboardView').style.display='block';
    $('#welcomeText').textContent=`Login sebagai ${username || 'admin'} · Perubahan tersimpan di database`;
  }
  async function checkSession() {
    try { const s=await api('/api/session'); if(s.authenticated) { showDashboard(s.username); await refreshData(); } else showLogin(); }
    catch { showLogin('Server belum dapat dihubungi. Pastikan aplikasi berjalan.',true); }
  }
  async function refreshData() {
    const data=await api('/api/admin/data');
    Object.assign(state,data);
    renderTables(); fillSettings(); fillEventOptions();
  }
  function renderTables() {
    $('#eventsTable').innerHTML=state.events.length ? state.events.map(e=>`<tr><td><b>${escapeHtml(e.title)}</b><br><span style="color:#918978">${escapeHtml(e.category)} · ${escapeHtml(e.location)}</span>${e.categories?.length?`<br><span style="color:#d8b860">Kategori: ${e.categories.map(escapeHtml).join(' · ')}</span>`:''}</td><td>${escapeHtml(fmtDate(e.start_date))}${e.end_date?`<br>— ${escapeHtml(fmtDate(e.end_date))}`:''}</td><td>${escapeHtml(e.status)}</td><td><div class="table-actions"><button class="mini-btn" data-edit-event="${e.id}">Edit</button><button class="mini-btn delete" data-delete-event="${e.id}">Hapus</button></div></td></tr>`).join('') : '<tr><td colspan="4">Belum ada event. Tambahkan event pertama melalui form di atas.</td></tr>';
    $('#matchesTable').innerHTML=state.matches.length ? state.matches.map(m=>`<tr><td>${escapeHtml(fmtDate(m.match_date))}<br>${escapeHtml(m.match_time || '—')}</td><td><b>${escapeHtml(m.home_team)} vs ${escapeHtml(m.away_team)}</b><br><span style="color:#918978">${escapeHtml(m.event_title || m.round_name || 'Tanpa event')}${m.event_category?` · ${escapeHtml(m.event_category)}`:''}</span></td><td>${m.home_score==null?'—':Number(m.home_score)} : ${m.away_score==null?'—':Number(m.away_score)}</td><td>${escapeHtml(m.status)}</td><td><div class="table-actions"><button class="mini-btn" data-edit-match="${m.id}">Edit</button><button class="mini-btn delete" data-delete-match="${m.id}">Hapus</button></div></td></tr>`).join('') : '<tr><td colspan="5">Belum ada pertandingan. Tambahkan jadwal melalui form di atas.</td></tr>';
  }
  function fillSettings() {
    const s=state.settings;
    $('#settingName').value=s.contact_name||''; $('#settingPhone').value=s.contact_phone||''; $('#settingEmail').value=s.contact_email||''; $('#settingVenue').value=s.venue||''; $('#settingAbout').value=s.about||'';
  }
  function fillEventOptions(selected='') {
    $('#matchEvent').innerHTML='<option value="">Tanpa event khusus</option>'+state.events.map(e=>`<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('');
    if(selected) $('#matchEvent').value=String(selected);
    fillMatchCategoryOptions(selected);
  }
  function fillMatchCategoryOptions(eventId='',selected='') {
    const event=state.events.find(item=>item.id===Number(eventId));
    const categories=event?.categories||[];
    $('#matchCategory').innerHTML=`<option value="">${event?'Tanpa kategori':'Pilih event terlebih dahulu'}</option>`+categories.map(category=>`<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    $('#matchCategory').disabled=!event||!categories.length;
    if(selected) $('#matchCategory').value=selected;
  }
  function resetEventForm() {
    $('#eventForm').reset(); $('#eventId').value=''; $('#eventFormTitle').textContent='Tambah event baru'; $('#cancelEventEdit').hidden=true; msg('#eventMessage','');
  }
  function resetMatchForm() {
    $('#matchForm').reset(); $('#matchId').value=''; $('#matchFormTitle').textContent='Tambah pertandingan'; $('#cancelMatchEdit').hidden=true; ['home','away'].forEach(side=>showLogo(side,'')); msg('#matchMessage','');
  }
  function showLogo(side, filename, selectedFile) {
    if(logoPreviewUrls[side]) URL.revokeObjectURL(logoPreviewUrls[side]);
    logoPreviewUrls[side]='';
    const preview=$(`#${side}LogoPreview`), status=$(`#${side}LogoStatus`), remove=$(`#${side}LogoRemoveWrap`), checkbox=$(`#${side}LogoRemove`);
    if(selectedFile) {
      logoPreviewUrls[side]=URL.createObjectURL(selectedFile);
      preview.src=logoPreviewUrls[side]; preview.hidden=false; status.textContent=`Logo baru: ${selectedFile.name}`; remove.hidden=true; checkbox.checked=false;
    } else if(filename) {
      preview.src=`/team-logos/${encodeURIComponent(filename)}`; preview.hidden=false; status.textContent='Logo tersimpan'; remove.hidden=false; checkbox.checked=false;
    } else {
      preview.removeAttribute('src'); preview.hidden=true; status.textContent='Belum ada logo.'; remove.hidden=true; checkbox.checked=false;
    }
  }
  function editEvent(id) {
    const e=state.events.find(x=>x.id===Number(id)); if(!e) return;
    $('#eventId').value=e.id; $('#eventTitle').value=e.title; $('#eventCategory').value=e.category; $('#eventStatus').value=e.status; $('#eventStart').value=e.start_date; $('#eventEnd').value=e.end_date||''; $('#eventLocation').value=e.location; $('#eventDescription').value=e.description;
    $('#eventCategories').value=(e.categories||[]).join('\n');
    $('#eventFormTitle').textContent='Edit event'; $('#cancelEventEdit').hidden=false; activatePanel('eventsPanel'); $('#eventForm').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function editMatch(id) {
    const m=state.matches.find(x=>x.id===Number(id)); if(!m) return;
    $('#matchId').value=m.id; fillEventOptions(m.event_id); fillMatchCategoryOptions(m.event_id,m.event_category); $('#matchDate').value=m.match_date; $('#matchTime').value=m.match_time||''; $('#homeTeam').value=m.home_team; $('#awayTeam').value=m.away_team; $('#homeScore').value=m.home_score??''; $('#awayScore').value=m.away_score??''; $('#matchVenue').value=m.venue||''; $('#matchStatus').value=m.status||'Terjadwal'; $('#matchRound').value=m.round_name||'';
    showLogo('home',m.home_logo); showLogo('away',m.away_logo);
    $('#matchFormTitle').textContent='Edit pertandingan'; $('#cancelMatchEdit').hidden=false; activatePanel('matchesPanel'); $('#matchForm').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function activatePanel(id) {
    $$('.admin-tab').forEach(b=>b.classList.toggle('active',b.dataset.panel===id));
    $$('.admin-panel').forEach(p=>p.classList.toggle('active',p.id===id));
  }
  $('#loginForm').addEventListener('submit',async e=>{
    e.preventDefault(); msg('#loginMessage','Memverifikasi...');
    try { const s=await api('/api/login',{method:'POST',body:json({username:$('#username').value,password:$('#password').value})}); $('#password').value=''; showDashboard(s.username); await refreshData(); }
    catch(err){msg('#loginMessage',err.message,true);}
  });
  $('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});}catch{} showLogin('Anda sudah keluar.');});
  $$('.admin-tab').forEach(b=>b.addEventListener('click',()=>activatePanel(b.dataset.panel)));
  $('#eventForm').addEventListener('submit',async e=>{
    e.preventDefault(); const id=$('#eventId').value;
    const categories=$('#eventCategories').value.split(/[,\n]/).map(value=>value.trim()).filter(Boolean);
    const data={title:$('#eventTitle').value,category:$('#eventCategory').value,categories,status:$('#eventStatus').value,start_date:$('#eventStart').value,end_date:$('#eventEnd').value,location:$('#eventLocation').value,description:$('#eventDescription').value};
    try { await api(id?`/api/admin/events/${id}`:'/api/admin/events',{method:id?'PUT':'POST',body:json(data)}); resetEventForm(); await refreshData(); msg('#eventMessage','Event berhasil disimpan.'); }
    catch(err){msg('#eventMessage',err.message,true);}
  });
  $('#cancelEventEdit').addEventListener('click',resetEventForm);
  $('#matchForm').addEventListener('submit',async e=>{
    e.preventDefault(); const id=$('#matchId').value;
    const data={event_id:$('#matchEvent').value||null,event_category:$('#matchCategory').value,match_date:$('#matchDate').value,match_time:$('#matchTime').value,home_team:$('#homeTeam').value,away_team:$('#awayTeam').value,home_score:$('#homeScore').value,away_score:$('#awayScore').value,venue:$('#matchVenue').value,status:$('#matchStatus').value,round_name:$('#matchRound').value};
    let savedId=id;
    try {
      const result=await api(id?`/api/admin/matches/${id}`:'/api/admin/matches',{method:id?'PUT':'POST',body:json(data)});
      savedId=id||String(result.id);
      $('#matchId').value=savedId;
      for(const side of ['home','away']) {
        const file=$(`#${side}Logo`).files[0];
        if(file) {
          await api(`/api/admin/matches/${savedId}/logos/${side}`,{
            method:'PUT',
            body:await file.arrayBuffer(),
            headers:{'Content-Type':file.type}
          });
        } else if($(`#${side}LogoRemove`).checked) {
          await api(`/api/admin/matches/${savedId}/logos/${side}`,{method:'DELETE'});
        }
      }
      await refreshData();
      resetMatchForm();
      msg('#matchMessage','Pertandingan dan logo tim berhasil disimpan.');
    } catch(err) {
      if(savedId) {
        $('#matchId').value=savedId;
        $('#matchFormTitle').textContent='Edit pertandingan';
        $('#cancelMatchEdit').hidden=false;
      }
      msg('#matchMessage',savedId?`Pertandingan tersimpan, tetapi logo atau pembaruan data gagal: ${err.message}`:err.message,true);
    }
  });
  $('#cancelMatchEdit').addEventListener('click',resetMatchForm);
  $('#matchEvent').addEventListener('change',()=>fillMatchCategoryOptions($('#matchEvent').value));
  for(const side of ['home','away']) {
    $(`#${side}Logo`).addEventListener('change',e=>showLogo(side,state.matches.find(match=>match.id===Number($('#matchId').value))?.[`${side}_logo`],e.target.files[0]));
  }
  $('#lineupForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const file=$('#lineupFile').files[0];
    if(!file) return;
    msg('#lineupMessage','Memeriksa file Excel...');
    try {
      const result=await api('/api/admin/lineups/import',{
        method:'POST',
        body:await file.arrayBuffer(),
        headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
      });
      $('#lineupForm').reset();
      msg('#lineupMessage',`${result.imported} data berhasil diimpor untuk ${result.matches} pertandingan. Lineup kini tampil di website.`);
    } catch(err) {
      msg('#lineupMessage',err.message,true);
    }
  });
  $('#settingsForm').addEventListener('submit',async e=>{
    e.preventDefault(); const data={contact_name:$('#settingName').value,contact_phone:$('#settingPhone').value,contact_email:$('#settingEmail').value,venue:$('#settingVenue').value,about:$('#settingAbout').value};
    try { await api('/api/admin/settings',{method:'PUT',body:json(data)}); await refreshData(); msg('#settingsMessage','Profil dan kontak berhasil diperbarui.'); }
    catch(err){msg('#settingsMessage',err.message,true);}
  });
  $('#passwordForm').addEventListener('submit',async e=>{
    e.preventDefault(); if($('#newPassword').value!==$('#confirmPassword').value){msg('#passwordMessage','Konfirmasi password baru tidak sama.',true);return;}
    try { await api('/api/admin/change-password',{method:'POST',body:json({current_password:$('#currentPassword').value,new_password:$('#newPassword').value})}); $('#passwordForm').reset(); msg('#passwordMessage','Password berhasil diperbarui. Gunakan password baru saat login berikutnya.'); }
    catch(err){msg('#passwordMessage',err.message,true);}
  });
  $('#eventsTable').addEventListener('click',async e=>{
    const edit=e.target.closest('[data-edit-event]'), del=e.target.closest('[data-delete-event]');
    if(edit) editEvent(edit.dataset.editEvent);
    if(del && confirm('Hapus event ini? Pertandingan yang terkait tetap ada, tetapi hubungan event akan dilepas.')) {
      try { await api(`/api/admin/events/${del.dataset.deleteEvent}`,{method:'DELETE'}); await refreshData(); }
      catch(err){alert(err.message);}
    }
  });
  $('#matchesTable').addEventListener('click',async e=>{
    const edit=e.target.closest('[data-edit-match]'), del=e.target.closest('[data-delete-match]');
    if(edit) editMatch(edit.dataset.editMatch);
    if(del && confirm('Yakin ingin menghapus pertandingan ini?')) {
      try { await api(`/api/admin/matches/${del.dataset.deleteMatch}`,{method:'DELETE'}); await refreshData(); }
      catch(err){alert(err.message);}
    }
  });
  checkSession();
})();