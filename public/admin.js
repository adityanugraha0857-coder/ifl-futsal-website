(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = v => { if(!v) return '—'; const d=new Date(`${v}T00:00:00`); return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(d); };
  const state = { events: [], matches: [], event_teams: [], competition_configs: [], participant_registrations: [], settings: {}, username: '' };
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
    renderTables(); fillSettings(); fillEventOptions(); fillParticipantsEventOptions($('#participantsEvent').value);
    fillRegistrationEvents($('#registrationEvent').value);
  }
  function renderTables() {
    $('#eventsTable').innerHTML=state.events.length ? state.events.map(e=>`<tr><td><b>${escapeHtml(e.title)}</b><br><span style="color:#918978">${escapeHtml(e.category)} · ${escapeHtml(e.location)} · ${Number(e.participant_count)||0} tim peserta${Number(e.pending_registration_count)?` · ${Number(e.pending_registration_count)} menunggu persetujuan`:''}</span>${e.categories?.length?`<br><span style="color:#d8b860">Kategori: ${e.categories.map(escapeHtml).join(' · ')}</span>`:''}</td><td>${escapeHtml(fmtDate(e.start_date))}${e.end_date?`<br>— ${escapeHtml(fmtDate(e.end_date))}`:''}</td><td>${escapeHtml(e.status)}</td><td><div class="table-actions"><button class="mini-btn" data-edit-event="${e.id}">Edit</button><button class="mini-btn delete" data-delete-event="${e.id}">Hapus</button></div></td></tr>`).join('') : '<tr><td colspan="4">Belum ada event. Tambahkan event pertama melalui form di atas.</td></tr>';
    $('#matchesTable').innerHTML=state.matches.length ? state.matches.map(m=>`<tr><td>${escapeHtml(fmtDate(m.match_date))}<br>${escapeHtml(m.match_time || '—')}</td><td><b>${escapeHtml(m.home_team)} vs ${escapeHtml(m.away_team)}</b><br><span style="color:#918978">${escapeHtml(m.event_title || m.round_name || 'Tanpa event')}${m.event_category?` · ${escapeHtml(m.event_category)}`:''}${m.phase==='group'?m.group_name?` · Grup ${escapeHtml(m.group_name)}`:' · Fase grup':m.phase==='knockout'?' · Babak gugur':''}</span></td><td>${m.home_score==null?'—':Number(m.home_score)} : ${m.away_score==null?'—':Number(m.away_score)}${m.home_penalty_score==null?'':`<br><small>Penalti ${Number(m.home_penalty_score)} : ${Number(m.away_penalty_score)}</small>`}</td><td>${escapeHtml(m.status)}</td><td><div class="table-actions"><button class="mini-btn" data-edit-match="${m.id}">Edit</button>${m.generated_bracket?'':'<button class="mini-btn delete" data-delete-match="'+m.id+'">Hapus</button>'}</div></td></tr>`).join('') : '<tr><td colspan="5">Belum ada pertandingan. Tambahkan jadwal melalui form di atas.</td></tr>';
  }
  function fillSettings() {
    const s=state.settings;
    $('#settingName').value=s.contact_name||''; $('#settingPhone').value=s.contact_phone||''; $('#settingPhone2').value=s.contact_phone_2||''; $('#settingEmail').value=s.contact_email||''; $('#settingVenue').value=s.venue||''; $('#settingAbout').value=s.about||'';
  }
  function fillEventOptions(selected='',homeTeam,awayTeam) {
    const currentHome=homeTeam===undefined?getMatchTeamName('home'):homeTeam;
    const currentAway=awayTeam===undefined?getMatchTeamName('away'):awayTeam;
    $('#matchEvent').innerHTML='<option value="">Tanpa event khusus</option>'+state.events.map(e=>`<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('');
    if(selected) $('#matchEvent').value=String(selected);
    fillMatchCategoryOptions(selected);
    fillMatchTeamOptions(selected,currentHome,currentAway);
  }
  function getMatchTeamName(side) {
    const select=$(`#${side}TeamSelect`);
    return !select.hidden && select.value !== '__manual__'
      ? select.value
      : $(`#${side}Team`).value.trim();
  }
  function updateTeamLogoPreview(side, teamName) {
    const eventId=Number($('#matchEvent').value);
    const participant=state.event_teams.find(item=>item.event_id===eventId &&
      item.team_name.trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID')===
      String(teamName||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID'));
    if(participant) {
      showLogo(side,participant.logo_name,null,false);
      return;
    }
    const existing=state.matches.find(match=>match.id===Number($('#matchId').value));
    const sameExistingTeam=existing?.event_id===eventId&&
      existing[`${side}_team`].trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID')===
      String(teamName||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID');
    showLogo(side,sameExistingTeam?existing[`${side}_logo`]:null,null,true);
  }
  function fillMatchTeamOptions(eventId='',homeTeam='',awayTeam='') {
    const teams=state.event_teams.filter(team=>team.event_id===Number(eventId));
    for(const side of ['home','away']) {
      const select=$(`#${side}TeamSelect`);
      const input=$(`#${side}Team`);
      const selectedTeam=side==='home'?homeTeam:awayTeam;
      if(!teams.length) {
        select.hidden=true;
        select.disabled=true;
        input.hidden=false;
        input.required=true;
        input.value=selectedTeam;
        updateTeamLogoPreview(side,input.value);
        continue;
      }
      select.hidden=false;
      select.disabled=false;
      select.required=true;
      select.innerHTML='<option value="">Pilih peserta event</option>'+
        teams.map(team=>`<option value="${escapeHtml(team.team_name)}">${escapeHtml(team.team_name)}</option>`).join('')+
        '<option value="__manual__">Input tim manual…</option>';
      const participant=teams.find(team=>team.team_name.trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID')===
        String(selectedTeam||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID'));
      if(participant) {
        select.value=participant.team_name;
        input.value=participant.team_name;
        input.hidden=true;
        input.required=false;
      } else if(!selectedTeam) {
        select.value='';
        input.value='';
        input.hidden=true;
        input.required=false;
      } else {
        select.value='__manual__';
        input.value=selectedTeam;
        input.hidden=false;
        input.required=true;
      }
      updateTeamLogoPreview(side,selectedTeam);
    }
  }
  function fillParticipantsEventOptions(selected='') {
    $('#participantsEvent').innerHTML='<option value="">Pilih event</option>'+state.events.map(e=>`<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('');
    if(selected && state.events.some(event=>event.id===Number(selected))) $('#participantsEvent').value=String(selected);
  }
  function fillRegistrationEvents(selected='') {
    const select=$('#registrationEvent');
    const previous=selected || select.value;
    select.innerHTML='<option value="">Pilih event</option>'+state.events.map(event=>`<option value="${event.id}">${escapeHtml(event.title)}</option>`).join('');
    if(previous && state.events.some(event=>event.id===Number(previous))) select.value=String(previous);
    if(!select.value && state.events.length) select.value=String(state.events[0].id);
    renderRegistrations();
  }
  function renderRegistrations() {
    const event=state.events.find(item=>item.id===Number($('#registrationEvent').value));
    const linkInput=$('#registrationLink');
    const token=event?.registration_token;
    linkInput.value=token?`${location.origin}/daftar/${token}`:'';
    $('#createRegistrationLink').disabled=!event;
    $('#copyRegistrationLink').disabled=!token;
    $('#revokeRegistrationLink').disabled=!token;
    const exportLink=$('#exportRegistrations');
    exportLink.hidden=!event;
    exportLink.href=event?`/api/admin/events/${event.id}/participants/export`:'#';
    const registrations=state.participant_registrations.filter(item=>item.event_id===event?.id);
    $('#registrationsTable').innerHTML=registrations.length?registrations.map(item=>`<tr>
      <td><b>${escapeHtml(item.team_name)}</b><br><a href="/team-logos/${encodeURIComponent(item.logo_name)}" target="_blank" rel="noopener noreferrer">Lihat logo ↗</a></td>
      <td>${escapeHtml(fmtDate(String(item.created_at||'').slice(0,10)))}</td>
      <td>${item.status==='pending'?'Menunggu persetujuan':item.status==='approved'?'Disetujui':item.status==='rejected'?'Ditolak':'Diganti impor'}</td>
      <td>${item.status==='pending'?`<div class="table-actions"><button class="mini-btn" data-approve-registration="${item.id}">Setujui</button><button class="mini-btn delete" data-reject-registration="${item.id}">Tolak</button></div>`:item.status==='approved'?`<button class="mini-btn delete" data-delete-registration="${item.id}">Hapus tim</button>`:'—'}</td>
    </tr>`).join(''):'<tr><td colspan="4">Belum ada pendaftar untuk event ini.</td></tr>';
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
    $('#matchForm').reset(); $('#matchId').value=''; $('#matchFormTitle').textContent='Tambah pertandingan'; $('#cancelMatchEdit').hidden=true; ['home','away'].forEach(side=>showLogo(side,''));
    ['matchEvent','matchCategory','homeTeam','awayTeam','homeTeamSelect','awayTeamSelect','matchPhase','matchRound'].forEach(id=>{ $(`#${id}`).disabled=false; });
    fillMatchTeamOptions($('#matchEvent').value);
    $('#generatedMatchNote').hidden=true;
    msg('#matchMessage','');
  }
  function showLogo(side, filename, selectedFile, canRemove=true) {
    if(logoPreviewUrls[side]) URL.revokeObjectURL(logoPreviewUrls[side]);
    logoPreviewUrls[side]='';
    const preview=$(`#${side}LogoPreview`), status=$(`#${side}LogoStatus`), remove=$(`#${side}LogoRemoveWrap`), checkbox=$(`#${side}LogoRemove`);
    if(selectedFile) {
      logoPreviewUrls[side]=URL.createObjectURL(selectedFile);
      preview.src=logoPreviewUrls[side]; preview.hidden=false; status.textContent=`Logo baru: ${selectedFile.name}`; remove.hidden=true; checkbox.checked=false;
    } else if(filename) {
      preview.src=`/team-logos/${encodeURIComponent(filename)}`; preview.hidden=false; status.textContent=canRemove?'Logo tersimpan':'Logo peserta event terpasang otomatis'; remove.hidden=!canRemove; checkbox.checked=false;
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
    $('#matchId').value=m.id; fillEventOptions(m.event_id); fillMatchCategoryOptions(m.event_id,m.event_category); fillMatchTeamOptions(m.event_id,m.home_team,m.away_team); $('#matchDate').value=m.match_date; $('#matchTime').value=m.match_time||''; $('#homeScore').value=m.home_score??''; $('#awayScore').value=m.away_score??''; $('#homePenaltyScore').value=m.home_penalty_score??''; $('#awayPenaltyScore').value=m.away_penalty_score??''; $('#matchVenue').value=m.venue||''; $('#matchStatus').value=m.status||'Terjadwal'; $('#matchRound').value=m.round_name||''; $('#matchPhase').value=m.phase||'other';
    const generated=Boolean(m.generated_bracket);
    ['matchEvent','matchCategory','homeTeam','awayTeam','homeTeamSelect','awayTeamSelect','matchPhase','matchRound'].forEach(id=>{ $(`#${id}`).disabled=generated; });
    $('#generatedMatchNote').hidden=!generated;
    updateTeamLogoPreview('home',m.home_team); updateTeamLogoPreview('away',m.away_team);
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
  $('#participantsForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const eventId=$('#participantsEvent').value;
    const file=$('#participantsFile').files[0];
    if(!eventId || !file) return;
    msg('#participantsMessage','Memeriksa file Excel dan logo tim...');
    try {
      const result=await api(`/api/admin/events/${encodeURIComponent(eventId)}/participants/import`,{
        method:'POST',
        body:await file.arrayBuffer(),
        headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
      });
      $('#participantsFile').value='';
      await refreshData();
      msg('#participantsMessage',`${result.imported} tim peserta berhasil diimpor. Daftar peserta event sudah diperbarui.`);
    } catch(err) {
      msg('#participantsMessage',err.message,true);
    }
  });
  $('#registrationEvent').addEventListener('change',()=>renderRegistrations());
  $('#createRegistrationLink').addEventListener('click',async()=>{
    const eventId=$('#registrationEvent').value;
    if(!eventId) return;
    msg('#registrationLinkMessage','Membuat link pendaftaran...');
    try {
      await api(`/api/admin/events/${encodeURIComponent(eventId)}/registration-link`,{method:'PUT'});
      await refreshData();
      msg('#registrationLinkMessage','Link aktif. Bagikan link ini kepada calon peserta.');
    } catch(err) {
      msg('#registrationLinkMessage',err.message,true);
    }
  });
  $('#copyRegistrationLink').addEventListener('click',async()=>{
    const value=$('#registrationLink').value;
    if(!value) return;
    try {
      await navigator.clipboard.writeText(value);
      msg('#registrationLinkMessage','Link berhasil disalin.');
    } catch {
      $('#registrationLink').focus();
      $('#registrationLink').select();
      msg('#registrationLinkMessage','Link sudah dipilih. Salin dengan Ctrl+C.');
    }
  });
  $('#revokeRegistrationLink').addEventListener('click',async()=>{
    const eventId=$('#registrationEvent').value;
    if(!eventId || !confirm('Nonaktifkan link ini? Link yang sudah dibagikan tidak akan bisa digunakan lagi.')) return;
    try {
      await api(`/api/admin/events/${encodeURIComponent(eventId)}/registration-link`,{method:'DELETE'});
      await refreshData();
      msg('#registrationLinkMessage','Link pendaftaran sudah dinonaktifkan.');
    } catch(err) {
      msg('#registrationLinkMessage',err.message,true);
    }
  });
  $('#registrationsTable').addEventListener('click',async event=>{
    const approve=event.target.closest('[data-approve-registration]');
    const reject=event.target.closest('[data-reject-registration]');
    const remove=event.target.closest('[data-delete-registration]');
    if(remove) {
      if(!confirm('Hapus tim yang sudah disetujui dari daftar peserta event? Jadwal pertandingan tetap tersimpan.')) return;
      try {
        await api(`/api/admin/participant-registrations/${remove.dataset.deleteRegistration}`,{method:'DELETE'});
        await refreshData();
        msg('#registrationLinkMessage','Tim dan roster terkait berhasil dihapus dari event.');
      } catch(err) {
        msg('#registrationLinkMessage',err.message,true);
      }
      return;
    }
    const button=approve||reject;
    if(!button) return;
    const status=approve?'approved':'rejected';
    if(status==='rejected'&&!confirm('Tolak pendaftaran tim ini?')) return;
    try {
      await api(`/api/admin/participant-registrations/${button.dataset[approve?'approveRegistration':'rejectRegistration']}`,{
        method:'PUT',
        body:json({status})
      });
      await refreshData();
      msg('#registrationLinkMessage',status==='approved'?'Tim disetujui dan ditambahkan ke daftar peserta event.':'Pendaftaran ditolak dan dihapus.');
    } catch(err) {
      msg('#registrationLinkMessage',err.message,true);
    }
  });
  $('#matchForm').addEventListener('submit',async e=>{
    e.preventDefault(); const id=$('#matchId').value;
    let status=$('#matchStatus').value;
    if(status==='Terjadwal' && $('#homeScore').value!=='' && $('#awayScore').value!=='') status='Selesai';
    const data={event_id:$('#matchEvent').value||null,event_category:$('#matchCategory').value,match_date:$('#matchDate').value,match_time:$('#matchTime').value,home_team:getMatchTeamName('home'),away_team:getMatchTeamName('away'),home_score:$('#homeScore').value,away_score:$('#awayScore').value,home_penalty_score:$('#homePenaltyScore').value,away_penalty_score:$('#awayPenaltyScore').value,venue:$('#matchVenue').value,status,round_name:$('#matchRound').value,phase:$('#matchPhase').value,group_name:''};
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
      msg('#matchMessage',result.warning|| (result.generated?'Pertandingan tersimpan. Bagan babak gugur otomatis telah dibuat.':'Pertandingan dan logo tim berhasil disimpan.'));
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
  $('#matchEvent').addEventListener('change',()=>{
    fillMatchCategoryOptions($('#matchEvent').value);
    fillMatchTeamOptions($('#matchEvent').value);
  });
  for(const side of ['home','away']) {
    $(`#${side}TeamSelect`).addEventListener('change',()=>{
      const manual=$(`#${side}TeamSelect`).value==='__manual__';
      $(`#${side}Team`).hidden=!manual;
      $(`#${side}Team`).required=manual;
      $(`#${side}Logo`).value='';
      if(!manual) $(`#${side}Team`).value=$(`#${side}TeamSelect`).value;
      updateTeamLogoPreview(side,getMatchTeamName(side));
    });
    $(`#${side}Team`).addEventListener('input',()=>{
      if($(`#${side}TeamSelect`).value==='__manual__') updateTeamLogoPreview(side,getMatchTeamName(side));
    });
  }
  for(const side of ['home','away']) {
    $(`#${side}Logo`).addEventListener('change',e=>showLogo(side,state.matches.find(match=>match.id===Number($('#matchId').value))?.[`${side}_logo`],e.target.files[0]));
  }
  $('#settingsForm').addEventListener('submit',async e=>{
    e.preventDefault(); const data={contact_name:$('#settingName').value,contact_phone:$('#settingPhone').value,contact_phone_2:$('#settingPhone2').value,contact_email:$('#settingEmail').value,venue:$('#settingVenue').value,about:$('#settingAbout').value};
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