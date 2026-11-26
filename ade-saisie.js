/* Saisie ADE – panneau de saisie des présences dans UPplanning (ADE), alimenté par l'appli Présence NFC.
   Chargé par le favori « Saisie ADE ». Ne clique jamais sur « Enregistrer » à votre place. */
(() => {
  if (window.__presenceAde) { window.__presenceAde.ouvrir(); return; }

  // ---------- Outils ----------
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const attendre = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const souris = (el, types) => types.forEach(type => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 })));
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const b64enc = t => { const o = new TextEncoder().encode(t); let s = ''; for (let i = 0; i < o.length; i += 8192) s += String.fromCharCode.apply(null, o.subarray(i, i + 8192)); return btoa(s); };
  const b64dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));

  // ---------- Configuration (gardée dans ce navigateur, sur ce PC) ----------
  const CLE = 'presenceAde';
  let conf = {};
  try { conf = JSON.parse(localStorage.getItem(CLE) || '{}'); } catch (e) {}
  function configurer() {
    const depot = prompt('Saisie ADE – configuration (une seule fois)\nDépôt GitHub privé de synchronisation :', conf.depot || 'Sobysun/presence-data');
    if (depot === null) return false;
    const jeton = prompt('Jeton d\'accès GitHub (le même que dans l\'appli du téléphone) :', conf.jeton || '');
    if (jeton === null) return false;
    conf = { depot: depot.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, ''), jeton: jeton.trim() };
    try { localStorage.setItem(CLE, JSON.stringify(conf)); } catch (e) {}
    return true;
  }
  const api = (methode, corps) => fetch(`https://api.github.com/repos/${conf.depot}/contents/ade.json`, {
    method: methode, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + conf.jeton, Accept: 'application/vnd.github+json' },
    body: corps ? JSON.stringify(corps) : undefined });
  async function lire() {
    const r = await api('GET');
    if (r.status === 404) return { s: [], sha: null };
    if (!r.ok) throw new Error(r.status === 401 ? 'jeton refusé' : 'GitHub ' + r.status);
    const j = await r.json();
    return { ...JSON.parse(b64dec(j.content)), sha: j.sha };
  }
  async function marquerFaite(id) { // ok:true dans le fichier → l'appli du téléphone la marquera « saisie »
    for (let essai = 0; essai < 4; essai++) {
      const f = await lire();
      (f.s || []).forEach(x => { if (x.id === id) x.ok = true; });
      const p = await api('PUT', { message: 'Séance saisie dans ADE', content: b64enc(JSON.stringify({ maj: new Date().toISOString(), s: f.s || [] })), ...(f.sha ? { sha: f.sha } : {}) });
      if (p.ok) return;
      if (p.status !== 409 && p.status !== 422) throw new Error('GitHub ' + p.status);
      await attendre(700);
    }
    throw new Error('conflit de synchronisation, réessayez');
  }

  // ---------- Fenêtre ADE « Saisie des présences » ----------
  function fenetreOuverte() {
    const champs = [...document.querySelectorAll('.x-grid3-td-value input')].filter(visible);
    if (!champs.length) return null;
    const dlg = champs[0].closest('.x-adeDialog') || champs[0].closest('[role=alertdialog]') || document.body;
    const txt = dlg.innerText || dlg.textContent;
    return { dlg, date: (txt.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1], debut: (txt.match(/(\d{2}:\d{2})\s*-\s*\d{2}:\d{2}/) || [])[1] };
  }
  const fermerListes = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  async function choisir(ligne, valeur) {
    const cellule = ligne.querySelector('.x-grid3-td-value');
    const combo = cellule && (cellule.querySelector('.x-ade-PacAttendancesCombo') || cellule);
    const champ = combo && combo.querySelector('input'), fleche = combo && combo.querySelector('.x-form-trigger');
    if (!champ) return false;
    if (norm(champ.value) === norm(valeur)) return true;
    ligne.scrollIntoView({ block: 'center' });
    await attendre(150);
    souris(fleche || champ, ['mousedown', 'mouseup', 'click']);
    let option = null;
    for (let i = 0; i < 15 && !option; i++) {
      await attendre(100);
      option = [...document.querySelectorAll('.x-combo-list-item, .x-combo-list div, .x-layer div, .x-menu-item')]
        .find(el => visible(el) && !el.closest('.x-grid3-row') && !el.closest('#presenceAdePanneau') && el.children.length === 0 && norm(el.textContent) === norm(valeur));
    }
    if (!option) { fermerListes(); return false; }
    souris(option, ['mouseover', 'mousedown', 'mouseup', 'click']);
    await attendre(200);
    return norm(champ.value) === norm(valeur);
  }
  async function remplir(s, f) {
    const lignes = [...f.dlg.querySelectorAll('.x-grid3-row')];
    const cible = (nom, prenom) => lignes.find(l => {
      const n = norm(l.querySelector('.x-grid3-td-name')?.textContent), p = norm(l.querySelector('.x-grid3-td-surname')?.textContent);
      return n === norm(nom) && (!prenom || p === norm(prenom) || p.startsWith(norm(prenom)) || norm(prenom).startsWith(p));
    });
    const echecs = [];
    for (const [valeur, liste] of [['Absent', s.a || []], ['Retard', s.r || []]])
      for (const [nom, prenom] of liste) {
        const l = cible(nom, prenom);
        if (!l) { echecs.push(nom + ' ' + prenom + ' → ' + valeur + ' (introuvable dans ADE)'); continue; }
        if (!(await choisir(l, valeur))) echecs.push(nom + ' ' + prenom + ' → ' + valeur);
      }
    return echecs;
  }

  // ---------- Panneau ----------
  let seances = [], etats = {}, attenteEnregistrer = null, messageGlobal = '';
  const panneau = document.createElement('div');
  panneau.id = 'presenceAdePanneau';
  panneau.innerHTML = `<style>
    #presenceAdePanneau{position:fixed;top:60px;right:14px;width:340px;max-height:80vh;display:flex;flex-direction:column;background:#fff;border:2px solid #1f5fa8;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);z-index:2147483000;font:13px/1.4 Arial,sans-serif;color:#222}
    #presenceAdePanneau .t{background:#1f5fa8;color:#fff;padding:8px 10px;border-radius:9px 9px 0 0;display:flex;align-items:center;gap:6px;cursor:move}
    #presenceAdePanneau .t b{flex:1} #presenceAdePanneau .t button{background:rgba(255,255,255,.2);color:#fff;border:0;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:13px}
    #presenceAdePanneau .m{padding:6px 10px;color:#555;font-size:12px;border-bottom:1px solid #eee}
    #presenceAdePanneau .l{overflow:auto;padding:6px}
    #presenceAdePanneau .s{border:2px solid #c9d6ea;border-radius:9px;padding:8px 10px;margin:6px 0;cursor:pointer;background:#f7f9fc}
    #presenceAdePanneau .s:hover{border-color:#1f5fa8}
    #presenceAdePanneau .s.ouv{border-color:#1e8a4c;box-shadow:0 0 0 2px #1e8a4c33}
    #presenceAdePanneau .s.cours{opacity:.6;cursor:wait}
    #presenceAdePanneau .s.prete{background:#fff4e0;border-color:#d68910;cursor:default}
    #presenceAdePanneau .s.err{background:#fdecea;border-color:#c0392b}
    #presenceAdePanneau .s .x{font-size:12px;margin-top:4px} #presenceAdePanneau .s .x b{display:block}
    #presenceAdePanneau .s button{margin-top:6px;border:1px solid #999;background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}
    #presenceAdePanneau .ok{color:#1e8a4c;font-weight:bold;padding:8px}
  </style>
  <div class="t"><b>📋 Présence NFC → ADE</b><button data-a="maj" title="Actualiser">🔄</button><button data-a="conf" title="Configuration">⚙</button><button data-a="fermer" title="Fermer">✕</button></div>
  <div class="m"></div><div class="l"></div>`;
  document.body.appendChild(panneau);
  const $m = panneau.querySelector('.m'), $l = panneau.querySelector('.l');

  function afficher() {
    const f = fenetreOuverte();
    $m.innerHTML = esc(messageGlobal || (seances.length ? 'Ouvrez un cours dans ADE (clic droit → Assiduités → Assiduité), puis appuyez sur la séance correspondante ci-dessous.' : ''));
    if (!seances.length) { $l.innerHTML = '<div class="ok">✅ Toutes les séances sont saisies dans ADE.</div>'; return; }
    $l.innerHTML = seances.map(s => {
      const e = etats[s.id] || {}, ouv = f && f.date === s.d && f.debut === s.h;
      const resume = (s.a?.length || 0) + ' absent(s), ' + (s.r?.length || 0) + ' retard(s)';
      let x = '';
      if (e.etat === 'prete') x = '<div class="x"><b>✓ Remplie. Vérifiez puis cliquez sur « Enregistrer » dans ADE.</b>La séance disparaîtra après l\'enregistrement.</div><button data-fait="' + esc(s.id) + '">Déjà enregistrée</button>';
      else if (e.etat === 'err') x = '<div class="x"><b>⚠ ' + esc(e.titre) + '</b>' + (e.details || []).map(esc).join('<br>') + '</div>' + (e.fenetreOk ? '<button data-fait="' + esc(s.id) + '">Corrigée à la main et enregistrée</button>' : '');
      else if (e.etat === 'cours') x = '<div class="x">⏳ Remplissage en cours…</div>';
      return `<div class="s ${e.etat || ''} ${ouv ? 'ouv' : ''}" data-id="${esc(s.id)}"><b>${esc(s.t)}</b> · ${esc(s.g || '')}<br>${esc(s.d)} à ${esc(s.h)} · ${esc(resume)}${ouv && !e.etat ? '<div class="x" style="color:#1e8a4c"><b>← fenêtre ouverte : appuyez pour remplir</b></div>' : ''}${x}</div>`;
    }).join('');
  }

  async function charger() {
    messageGlobal = '⏳ Lecture des séances…'; afficher();
    try {
      const f = await lire();
      seances = (f.s || []).filter(x => !x.ok);
      messageGlobal = f.maj ? '' : '';
      Object.keys(etats).forEach(id => { if (!seances.some(s => s.id === id)) delete etats[id]; });
    } catch (e) { messageGlobal = '⚠ ' + e.message + ' (⚙ pour vérifier la configuration)'; }
    afficher();
  }

  async function fait(id) {
    const s = seances.find(x => x.id === id);
    try {
      await marquerFaite(id);
      seances = seances.filter(x => x.id !== id); delete etats[id];
      messageGlobal = '✓ ' + (s ? s.t + ' du ' + s.d + ' ' + s.h : 'Séance') + ' enregistrée. Synchronisée avec le téléphone.';
    } catch (e) { messageGlobal = '⚠ Enregistrement noté dans ADE mais synchro impossible : ' + e.message; }
    afficher();
  }

  async function traiter(id) {
    const s = seances.find(x => x.id === id);
    if (!s || (etats[id] && etats[id].etat === 'cours')) return;
    const f = fenetreOuverte();
    if (!f) { etats[id] = { etat: 'err', titre: 'Fenêtre ADE non ouverte', details: ['Clic droit sur le cours du ' + s.d + ' à ' + s.h + ' → Assiduités → Assiduité, puis réappuyez ici.'] }; return afficher(); }
    if (f.date !== s.d || f.debut !== s.h) { etats[id] = { etat: 'err', titre: 'Ce n\'est pas le bon cours', details: ['La fenêtre ouverte est celle du ' + (f.date || '?') + ' à ' + (f.debut || '?') + '.', 'Ouvrez celle du ' + s.d + ' à ' + s.h + '.'] }; return afficher(); }
    etats[id] = { etat: 'cours' }; afficher();
    const echecs = await remplir(s, f);
    etats[id] = echecs.length ? { etat: 'err', fenetreOk: true, titre: 'À faire à la main dans ADE :', details: echecs.concat(['Les autres sont remplis. Corrigez puis cliquez « Enregistrer ».']) } : { etat: 'prete' };
    attenteEnregistrer = id;
    afficher();
  }

  // Clic sur « Enregistrer » dans ADE → la séance en attente est validée
  document.addEventListener('click', ev => {
    if (!attenteEnregistrer || panneau.contains(ev.target)) return;
    let el = ev.target;
    for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
      if (norm(el.textContent) === 'enregistrer') {
        const id = attenteEnregistrer; attenteEnregistrer = null;
        messageGlobal = '⏳ Enregistrement…'; afficher();
        setTimeout(() => fait(id), 1500);
        return;
      }
    }
  }, true);

  panneau.addEventListener('click', ev => {
    const a = ev.target.closest('[data-a]'), f = ev.target.closest('[data-fait]'), s = ev.target.closest('.s');
    if (a) {
      if (a.dataset.a === 'maj') charger();
      if (a.dataset.a === 'conf') { if (configurer()) charger(); }
      if (a.dataset.a === 'fermer') { panneau.style.display = 'none'; }
      return;
    }
    if (f) { ev.stopPropagation(); return fait(f.dataset.fait); }
    if (s) traiter(s.dataset.id);
  });

  // Déplacer le panneau par sa barre de titre
  const barre = panneau.querySelector('.t');
  barre.addEventListener('mousedown', ev => {
    if (ev.target.closest('button')) return;
    const r = panneau.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    const bouge = e => { panneau.style.left = (e.clientX - dx) + 'px'; panneau.style.top = (e.clientY - dy) + 'px'; panneau.style.right = 'auto'; };
    const fin = () => { document.removeEventListener('mousemove', bouge); document.removeEventListener('mouseup', fin); };
    document.addEventListener('mousemove', bouge); document.addEventListener('mouseup', fin);
  });

  let derniereFenetre = '';
  setInterval(() => { // repère la fenêtre ADE ouverte pour surligner la bonne séance
    if (panneau.style.display === 'none') return;
    const f = fenetreOuverte(), cle = f ? f.date + ' ' + f.debut : '';
    if (cle !== derniereFenetre) { derniereFenetre = cle; afficher(); }
  }, 1500);

  window.__presenceAde = { ouvrir() { panneau.style.display = 'flex'; charger(); } };
  if (!conf.depot || !conf.jeton) { if (!configurer()) { panneau.remove(); delete window.__presenceAde; return; } }
  charger();
})();
