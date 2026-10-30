// =====================================================================
// FroidPass — application technicien
// =====================================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = window.FROIDPASS_CONFIG || {};
const $view = document.getElementById("view");
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("VOTRE-PROJET");
const sb = configured ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

// ---------- Règles métier : fréquences préventives (jours) ----------
const TYPES = {
  split:    { label: "Split mural / console", ic: "❄️", cotier: 60, interieur: 90, pts: "Filtres, évaporateur, évacuation des condensats, HP/BP, intensité" },
  cassette: { label: "Cassette / gainable", ic: "🌀", cotier: 60, interieur: 90, pts: "Bac et pompe de relevage, filtres, équilibrage" },
  groupe:   { label: "Groupe extérieur", ic: "🔆", cotier: 60, interieur: 90, pts: "Corrosion ailettes condenseur, serrage bornes, condensateur" },
  chambre:  { label: "Chambre froide", ic: "🧊", cotier: 30, interieur: 30, pts: "Joints de porte, dégivrage, consigne, alarme" },
  vitrine:  { label: "Armoire / vitrine réfrigérée", ic: "🥶", cotier: 60, interieur: 90, pts: "Condenseur, joints, thermostat" }
};
const PLANS = [
  { id: "fondateur",      nom: "Membre fondateur", prix: 15000, detail: "3 mois de Solo, puis prix bloqué à 10 000 FCFA", hot: true },
  { id: "solo_mensuel",   nom: "Solo · 1 mois",  prix: 10000,  detail: "60 équipements, relances, certificat" },
  { id: "solo_annuel",    nom: "Solo · 12 mois", prix: 100000, detail: "10 mois payés pour 12" },
  { id: "pro_mensuel",    nom: "Pro · 1 mois",   prix: 20000,  detail: "Équipements illimités" },
  { id: "pro_annuel",     nom: "Pro · 12 mois",  prix: 200000, detail: "10 mois payés pour 12" },
  { id: "equipe_mensuel", nom: "Équipe · 1 mois", prix: 40000, detail: "Illimité, pour une équipe" }
];
const DAY = 864e5;
const _n = new Date();
const TODAY = Date.UTC(_n.getFullYear(), _n.getMonth(), _n.getDate());
const iso = t => new Date(t).toISOString().slice(0, 10);
const fr = s => s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—";
const fcfa = n => Number(n).toLocaleString("fr-FR").replace(/ | /g, " ") + " FCFA";
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const waNum = s => String(s || "").replace(/\D/g, "");

let S = { user: null, tech: null, clients: [], eqs: [], ints: [], pays: [] };

// ---------- Outils ----------
let tt;
function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), 3200); }
function modal(html) { document.getElementById("modal").innerHTML = html ? `<div class="modal" data-close>${html}</div>` : ""; }
document.addEventListener("click", e => { if (e.target.matches("[data-close]")) modal(""); });
const publicUrl = code => location.origin + "/e.html?c=" + code;
const client = id => S.clients.find(c => c.id === id) || {};
const intsOf = id => S.ints.filter(x => x.equipement_id === id).sort((a, b) => b.date.localeCompare(a.date));
const freq = e => TYPES[e.type][e.environnement];
function nextDue(e) {
  const last = intsOf(e.id).find(x => x.type === "preventif");
  return iso(Date.parse(last ? last.date : e.date_pose) + freq(e) * DAY);
}
function status(e) {
  const d = Math.round((Date.parse(nextDue(e)) - TODAY) / DAY);
  if (d < 0) return { cls: "p-bad", txt: `En retard de ${-d} j`, d };
  if (d <= 14) return { cls: "p-warn", txt: `Dû dans ${d} j`, d };
  return { cls: "p-ok", txt: `À jour · ${d} j`, d };
}
function flags(x) {
  const out = [];
  if (x.t_soufflage != null && x.t_reprise != null) {
    const dt = Number(x.t_reprise) - Number(x.t_soufflage);
    if (dt < 8) out.push(`Écart reprise/soufflage de ${dt.toFixed(1)} °C, plutôt faible : vérifier l'encrassement de l'évaporateur et la charge en fluide (mesure de surchauffe). Indication à confirmer sur place.`);
  }
  if (/corros/i.test(x.observations || "")) out.push("Corrosion signalée : prévoir un traitement anticorrosion et rapprocher le contrôle.");
  return out;
}
function offreActive() {
  const t = S.tech; if (!t) return "decouverte";
  return t.offre !== "decouverte" && t.fin_abonnement && Date.parse(t.fin_abonnement) >= TODAY ? t.offre : "decouverte";
}
const peutRelancer = () => offreActive() !== "decouverte";

// ---------- Données ----------
async function loadAll() {
  const [t, c, e, i, p] = await Promise.all([
    sb.from("techniciens").select("*").eq("id", S.user.id).single(),
    sb.from("clients").select("*").order("nom"),
    sb.from("equipements").select("*").order("created_at"),
    sb.from("interventions").select("*").order("date", { ascending: false }),
    sb.from("paiements").select("*").order("created_at", { ascending: false })
  ]);
  for (const r of [t, c, e, i, p]) if (r.error) throw r.error;
  S.tech = t.data; S.clients = c.data; S.eqs = e.data; S.ints = i.data; S.pays = p.data;
}

// ---------- Routage ----------
async function route() {
  if (!configured) return renderNotConfigured();
  const h = (location.hash || "#tableau").slice(1);
  if (!S.user) { document.getElementById("menu").hidden = true; return renderAuth(h === "inscription" ? "inscription" : "connexion"); }
  document.getElementById("menu").hidden = false;
  document.querySelectorAll("#menu a").forEach(a => a.classList.toggle("cur", h.startsWith(a.dataset.v) || (h.startsWith("eq-") && a.dataset.v === "parc")));
  window.scrollTo(0, 0);
  if (h.startsWith("eq-")) return renderEq(h.slice(3));
  if (h.startsWith("cert-")) return renderCert(h.slice(5));
  if (h === "etiquettes") return renderLabels();
  if (h === "parc") return renderParc();
  if (h === "clients") return renderClients();
  if (h === "abonnement") return renderAbo();
  if (h === "profil") return renderProfil();
  return renderTableau();
}
window.addEventListener("hashchange", route);

// ---------- Écrans ----------
function renderNotConfigured() {
  $view.innerHTML = `<div class="panel auth"><h3>Configuration requise</h3>
  <p class="m">Renseignez SUPABASE_URL et SUPABASE_ANON_KEY dans <span class="mono">config.js</span> (voir le guide de mise en ligne).</p></div>`;
}

function renderAuth(mode) {
  const ins = mode === "inscription";
  $view.innerHTML = `<div class="panel auth">
    <h3 style="font-size:24px">${ins ? "Créer mon compte technicien" : "Connexion"}</h3>
    <form class="form" id="authForm" style="grid-template-columns:1fr">
      ${ins ? `<label>Nom complet<input class="field" name="nom" required></label>
      <label>Numéro WhatsApp<input class="field" name="whatsapp" placeholder="+229 01 XX XX XX XX" required></label>
      <label>Ville<select class="field" name="ville"><option>Cotonou</option><option>Abomey-Calavi</option><option>Porto-Novo</option><option>Autre</option></select></label>` : ""}
      <label>E-mail<input class="field" type="email" name="email" required autocomplete="email"></label>
      <label>Mot de passe<input class="field" type="password" name="password" minlength="8" required autocomplete="${ins ? "new-password" : "current-password"}"></label>
      <button class="btn btn-hot" type="submit">${ins ? "Créer mon compte gratuit" : "Se connecter"}</button>
    </form>
    <p class="m" style="margin-top:14px">${ins ? `Déjà inscrit ? <a href="#connexion">Se connecter</a>` : `Pas encore de compte ? <a href="#inscription">Créer un compte gratuit</a> · <a href="#" id="reset">Mot de passe oublié</a>`}</p>
  </div>`;
  document.getElementById("authForm").onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target)); const b = ev.target.querySelector("button"); b.disabled = true;
    try {
      if (ins) {
        const { data, error } = await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { nom: f.nom, whatsapp: f.whatsapp, ville: f.ville }, emailRedirectTo: location.origin + "/app.html" } });
        if (error) throw error;
        if (!data.session) { $view.innerHTML = `<div class="panel auth"><h3>Vérifiez votre e-mail</h3><p class="m">Un lien de confirmation a été envoyé à ${esc(f.email)}. Cliquez dessus puis revenez vous connecter.</p></div>`; return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) throw error;
      }
    } catch (e) { toast(e.message.includes("Invalid login") ? "E-mail ou mot de passe incorrect" : e.message); b.disabled = false; }
  };
  const r = document.getElementById("reset");
  if (r) r.onclick = async e => {
    e.preventDefault(); const email = document.querySelector("[name=email]").value;
    if (!email) return toast("Saisissez d'abord votre e-mail");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/app.html#profil" });
    toast(error ? error.message : "E-mail de réinitialisation envoyé");
  };
}

function renderTableau() {
  const sts = S.eqs.map(status);
  const late = sts.filter(s => s.d < 0).length, soon = sts.filter(s => s.d >= 0 && s.d <= 14).length;
  const relances = [...S.eqs].sort((a, b) => status(a).d - status(b).d).filter(e => status(e).d <= 14);
  const visites = S.eqs.reduce((n, e) => n + Math.round(365 / freq(e)), 0);
  $view.innerHTML = `
  <h1 style="font-size:30px;margin-bottom:6px">Bonjour ${esc((S.tech.nom || "").split(" ")[0])}</h1>
  <p class="m" style="margin-bottom:16px">Offre : <b>${labelOffre()}</b>${S.tech.fondateur ? " · Membre fondateur" : ""}</p>
  ${!S.tech.whatsapp || !S.tech.nom ? `<div class="panel" style="border-color:var(--heat)">Complétez votre <a href="#profil">profil</a> (nom, entreprise, WhatsApp) : ces informations apparaissent sur vos carnets QR et vos certificats.</div>` : ""}
  <div class="kpis">
    <div class="kpi"><b>${S.clients.length}</b><span>clients</span></div>
    <div class="kpi"><b>${S.eqs.length}</b><span>équipements</span></div>
    <div class="kpi alert"><b>${late}</b><span>entretiens en retard</span></div>
    <div class="kpi"><b>${soon}</b><span>à faire sous 14 jours</span></div>
  </div>
  <div class="grid2">
    <div class="panel"><h3>Relances à envoyer</h3>
      ${relances.length ? relances.map(e => `<div style="padding:10px 0;border-top:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(client(e.client_id).nom)}</b><span class="pill ${status(e).cls}">${status(e).txt}</span></div>
        <div class="m">${esc(e.emplacement)} · ${TYPES[e.type].label}</div>
        <button class="btn btn-teal btn-sm" style="margin-top:8px" data-relance="${e.id}">Préparer le message WhatsApp</button></div>`).join("")
      : `<p class="empty">Aucune relance dans les 14 prochains jours.</p>`}
    </div>
    <div>
      <div class="panel" style="background:var(--ink);color:#eaf7f9;border:0"><h3>Argument contrat annuel</h3>
        <p style="color:#a9c9d0;font-size:14.5px">Votre parc représente <b style="color:#fff">${visites} visites préventives par an</b>. C'est la base chiffrée de vos propositions de contrat d'entretien.</p></div>
      <div class="panel"><h3>Démarrer</h3>
        <button class="btn btn-hot" style="width:100%;margin-bottom:8px" data-addeq>+ Nouvel équipement</button>
        <a class="btn btn-ghost" style="width:100%" href="#clients">+ Nouveau client</a></div>
    </div>
  </div>`;
}

function eqRow(e) {
  const s = status(e), t = TYPES[e.type];
  return `<a class="row" href="#eq-${e.id}"><div class="ic">${t.ic}</div>
    <div><div class="t">${esc(e.emplacement)}</div><div class="m">${esc(client(e.client_id).nom)} · ${t.label} · ${esc(e.marque)} ${esc(e.puissance)}</div></div>
    <span class="pill ${s.cls}">${s.txt}</span></a>`;
}

function renderParc() {
  const sorted = [...S.eqs].sort((a, b) => status(a).d - status(b).d);
  $view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <h1 style="font-size:28px">Mon parc</h1>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-ghost btn-sm" href="#etiquettes">Imprimer les étiquettes QR</a><button class="btn btn-ghost btn-sm" id="csv">Exporter (CSV)</button><button class="btn btn-hot btn-sm" data-addeq>+ Équipement</button></div></div>
    <div class="panel"><input class="field" id="q" placeholder="Rechercher (client, emplacement, marque…)" style="margin-bottom:8px">
    <div id="list">${sorted.map(eqRow).join("") || `<p class="empty">Aucun équipement. Commencez par créer un client, puis un équipement.</p>`}</div></div>`;
  document.getElementById("q").oninput = ev => {
    const q = ev.target.value.toLowerCase();
    document.getElementById("list").innerHTML = sorted.filter(e => (e.emplacement + client(e.client_id).nom + e.marque).toLowerCase().includes(q)).map(eqRow).join("");
  };
  document.getElementById("csv").onclick = exportCsv;
}

function measHTML(x) {
  const m = [];
  if (x.hp != null) m.push(`HP ${x.hp} bar`); if (x.bp != null) m.push(`BP ${x.bp} bar`); if (x.intensite != null) m.push(`I ${x.intensite} A`);
  if (x.t_soufflage != null) m.push(`Souffl. ${x.t_soufflage} °C`); if (x.t_reprise != null) m.push(`Rep. ${x.t_reprise} °C`);
  return m.length ? `<div class="meas">${m.map(v => `<span>${v}</span>`).join("")}</div>` : "";
}

function renderEq(id) {
  const e = S.eqs.find(x => x.id === id);
  if (!e) { $view.innerHTML = `<p class="empty">Équipement introuvable. <a href="#parc">Retour</a></p>`; return; }
  const s = status(e), t = TYPES[e.type], list = intsOf(e.id);
  $view.innerHTML = `<a href="#parc" class="m">← Retour au parc</a>
  <div class="grid2" style="margin-top:10px">
    <div class="panel">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="font-size:23px">${t.ic} ${esc(e.emplacement)}</h3><span class="pill ${s.cls}">${s.txt}</span></div>
      <p class="m">${esc(client(e.client_id).nom)} · ${t.label} · ${esc(e.marque)} ${esc(e.puissance)} · <span class="mono">${esc(e.fluide)}</span> · ${e.environnement === "cotier" ? "côtier" : "intérieur"}</p>
      <p style="margin:10px 0 16px;font-size:14px">Fréquence : <b>${freq(e)} jours</b> · Prochain entretien : <b class="mono">${fr(nextDue(e))}</b><br><span class="m">Points de contrôle : ${t.pts}</span></p>
      <h3>Nouvelle intervention</h3>
      <div class="ai"><b style="font-size:14.5px">Saisie rapide</b>
        <p class="m" style="margin:4px 0 8px">Écrivez comme vous parlez, l'application remplit la fiche.</p>
        <textarea class="field" id="dict" rows="2" placeholder="Préventif, filtres nettoyés, HP 27 bars, BP 8,5, intensité 6,3 A, soufflage 14, reprise 25"></textarea>
        <button class="btn btn-teal btn-sm" style="margin-top:8px" id="parse">Remplir la fiche</button></div>
      <form class="form" id="intForm">
        <label>Date<input class="field" type="date" name="date" value="${iso(TODAY)}" required></label>
        <label>Type<select class="field" name="type"><option value="preventif">Préventif</option><option value="curatif">Curatif</option></select></label>
        <label>HP (bar)<input class="field mono" name="hp" inputmode="decimal"></label>
        <label>BP (bar)<input class="field mono" name="bp" inputmode="decimal"></label>
        <label>Intensité absorbée (A)<input class="field mono" name="intensite" inputmode="decimal"></label>
        <label>T soufflage (°C)<input class="field mono" name="t_soufflage" inputmode="decimal"></label>
        <label>T reprise (°C)<input class="field mono" name="t_reprise" inputmode="decimal"></label>
        <label class="full">Observations<textarea class="field" name="observations" rows="2"></textarea></label>
        <div class="full"><button class="btn btn-hot" type="submit">Enregistrer l'intervention</button></div>
      </form>
    </div>
    <div>
      <div class="panel"><h3>Étiquette QR</h3>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div class="qr" id="qr"></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <a class="btn btn-ghost btn-sm" href="${publicUrl(e.code_public)}" target="_blank" rel="noopener">Voir le carnet public</a>
          <a class="btn btn-ghost btn-sm" href="#cert-${e.id}">Certificat d'entretien</a>
          <button class="btn btn-teal btn-sm" data-relance="${e.id}">Relance WhatsApp</button>
          <button class="btn btn-ghost btn-sm" id="delEq" style="color:var(--bad)">Supprimer</button></div></div></div>
      <div class="panel"><h3>Historique</h3><div class="hist">${list.length ? list.map(x => `
        <div class="it"><b class="mono" style="font-size:13.5px">${fr(x.date)}</b> · <b>${x.type === "preventif" ? "Préventif" : "Curatif"}</b>
          <button class="btn btn-sm noprint" style="padding:0 6px;color:var(--mute);background:none" data-delint="${x.id}" title="Supprimer">✕</button>
          <div class="m">${esc(x.observations)}</div>${measHTML(x)}${flags(x).map(f => `<div class="flag">⚠ ${f}</div>`).join("")}</div>`).join("")
        : `<p class="empty">Aucune intervention.</p>`}</div></div>
    </div>
  </div>`;
  if (window.QRCode) new QRCode(document.getElementById("qr"), { text: publicUrl(e.code_public), width: 128, height: 128, colorDark: "#0b2230", colorLight: "#ffffff" });
  document.getElementById("parse").onclick = parseDict;
  document.getElementById("intForm").onsubmit = async ev => {
    ev.preventDefault();
    const o = Object.fromEntries(new FormData(ev.target));
    for (const k of ["hp", "bp", "intensite", "t_soufflage", "t_reprise"]) o[k] = o[k] === "" ? null : Number(String(o[k]).replace(",", "."));
    const b = ev.target.querySelector("button"); b.disabled = true;
    const { error } = await sb.from("interventions").insert({ ...o, equipement_id: e.id });
    if (error) { toast(error.message); b.disabled = false; return; }
    await loadAll(); renderEq(e.id); toast("Intervention enregistrée · prochain entretien recalculé");
  };
  document.getElementById("delEq").onclick = () => confirmBox(`Supprimer « ${esc(e.emplacement)} » et tout son historique ?`, async () => {
    const { error } = await sb.from("equipements").delete().eq("id", e.id);
    if (error) return toast(error.message);
    await loadAll(); location.hash = "parc"; toast("Équipement supprimé");
  });
  document.querySelectorAll("[data-delint]").forEach(btn => btn.onclick = () => confirmBox("Supprimer cette intervention ?", async () => {
    const { error } = await sb.from("interventions").delete().eq("id", btn.dataset.delint);
    if (error) return toast(error.message);
    await loadAll(); renderEq(e.id);
  }));
}

function parseDict() {
  const t = document.getElementById("dict").value.replace(/(\d),(\d)/g, "$1.$2");
  const f = document.getElementById("intForm");
  const grab = re => { const m = t.match(re); return m ? m[1] : ""; };
  f.hp.value = grab(/\bHP\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  f.bp.value = grab(/\bBP\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  f.intensite.value = grab(/intensit[ée]\s*[:=]?\s*(\d+(?:\.\d+)?)/i) || grab(/(\d+(?:\.\d+)?)\s*A\b/);
  f.t_soufflage.value = grab(/souffl\w*\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  f.t_reprise.value = grab(/reprise\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  f.type.value = /curatif|panne|d[ée]pannage/i.test(t) ? "curatif" : "preventif";
  const obs = t.split(/[,;]|\.(?!\d)/).map(s => s.trim()).filter(s => s && !/\b(HP|BP)\b|intensit|souffl|reprise|^pr[ée]ventif$|^curatif$/i.test(s));
  f.observations.value = obs.map(s => s[0].toUpperCase() + s.slice(1)).join(". ") + (obs.length ? "." : "");
  toast("Fiche remplie : vérifiez avant d'enregistrer");
}

function confirmBox(msg, ok) {
  modal(`<div class="panel"><p style="margin-bottom:14px">${msg}</p><div style="display:flex;gap:8px"><button class="btn btn-hot" id="cOk">Confirmer</button><button class="btn btn-ghost" data-close>Annuler</button></div></div>`);
  document.getElementById("cOk").onclick = () => { modal(""); ok(); };
}

function openAddEq() {
  if (!S.clients.length) { location.hash = "clients"; toast("Créez d'abord un client"); return; }
  modal(`<div class="panel"><h3>Nouvel équipement</h3><form class="form" id="eqForm">
    <label class="full">Client<select class="field" name="client_id">${S.clients.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join("")}</select></label>
    <label class="full">Emplacement<input class="field" name="emplacement" placeholder="Ex. Chambre 12, Cuisine, Salle serveur" required></label>
    <label>Type<select class="field" name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select></label>
    <label>Environnement<select class="field" name="environnement"><option value="cotier">Côtier / exposé</option><option value="interieur">Intérieur protégé</option></select></label>
    <label>Marque<input class="field" name="marque"></label>
    <label>Puissance<input class="field" name="puissance" placeholder="12 000 BTU, 3,5 kW…"></label>
    <label>Fluide frigorigène<select class="field" name="fluide"><option>R410A</option><option>R32</option><option>R22</option><option>R404A</option><option>R134a</option><option>R290</option><option>Autre</option></select></label>
    <label>Date de pose<input class="field" type="date" name="date_pose" value="${iso(TODAY)}"></label>
    <div class="full" style="display:flex;gap:8px"><button class="btn btn-hot" type="submit">Créer et générer le QR</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div>
  </form></div>`);
  document.getElementById("eqForm").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target));
    const { data, error } = await sb.from("equipements").insert(o).select().single();
    if (error) { toast(error.message.startsWith("QUOTA") ? error.message.replace("QUOTA: ", "") : error.message); return; }
    modal(""); await loadAll(); location.hash = "eq-" + data.id; toast("Équipement créé · QR prêt");
  };
}

function relance(id) {
  if (!peutRelancer()) { location.hash = "abonnement"; toast("Les relances clients sont incluses à partir de l'offre Solo"); return; }
  const e = S.eqs.find(x => x.id === id), c = client(e.client_id), s = status(e);
  const msg = `Bonjour ${c.contact || ""},\n\nC'est ${S.tech.nom}${S.tech.entreprise ? " (" + S.tech.entreprise + ")" : ""}. L'entretien préventif de votre équipement « ${e.emplacement} » ${s.d < 0 ? "est en retard depuis le " + fr(nextDue(e)) : "est prévu le " + fr(nextDue(e))}.\n\nUn entretien régulier évite les pannes et protège votre compresseur, surtout avec l'air salin. Quel créneau vous convient cette semaine ?\n\nVotre carnet d'entretien : ${publicUrl(e.code_public)}`;
  modal(`<div class="panel"><h3>Message pour ${esc(c.nom)}</h3><p class="m">Destinataire : ${esc(c.whatsapp || "numéro non renseigné")}</p>
    <div class="msgbox" id="msgTxt">${esc(msg)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${c.whatsapp ? `<a class="btn btn-teal btn-sm" href="https://wa.me/${waNum(c.whatsapp)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Ouvrir dans WhatsApp</a>` : ""}
      <button class="btn btn-ghost btn-sm" id="cp">Copier</button><button class="btn btn-ghost btn-sm" data-close>Fermer</button></div></div>`);
  document.getElementById("cp").onclick = async () => { try { await navigator.clipboard.writeText(msg); toast("Message copié"); } catch { toast("Sélectionnez le texte pour le copier"); } };
}

function renderClients() {
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:14px">Clients</h1>
  <div class="grid2"><div class="panel">${S.clients.map(c => {
    const n = S.eqs.filter(e => e.client_id === c.id).length;
    return `<div class="row" style="cursor:default"><div class="ic">🏢</div><div><div class="t">${esc(c.nom)}</div><div class="m">${esc(c.contact)} · ${esc(c.whatsapp)} · ${n} équipement(s)</div></div>
      <button class="btn btn-ghost btn-sm" data-delcli="${c.id}" style="color:var(--bad)">Supprimer</button></div>`;
  }).join("") || `<p class="empty">Aucun client pour l'instant.</p>`}</div>
  <div class="panel"><h3>Nouveau client</h3><form class="form" id="cliForm" style="grid-template-columns:1fr">
    <label>Nom de l'établissement<input class="field" name="nom" placeholder="Hôtel, clinique, restaurant…" required></label>
    <label>Personne à contacter<input class="field" name="contact" placeholder="M. / Mme …"></label>
    <label>WhatsApp du client<input class="field" name="whatsapp" placeholder="+229 01 XX XX XX XX"></label>
    <button class="btn btn-hot" type="submit">Ajouter le client</button></form></div></div>`;
  document.getElementById("cliForm").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target));
    const { error } = await sb.from("clients").insert(o);
    if (error) return toast(error.message);
    await loadAll(); renderClients(); toast("Client ajouté");
  };
  document.querySelectorAll("[data-delcli]").forEach(b => b.onclick = () => confirmBox("Supprimer ce client et tous ses équipements ?", async () => {
    const { error } = await sb.from("clients").delete().eq("id", b.dataset.delcli);
    if (error) return toast(error.message);
    await loadAll(); renderClients();
  }));
}

function labelOffre() {
  const o = offreActive();
  const n = { decouverte: "Découverte (gratuite, 10 équipements)", solo: "Solo", pro: "Pro", equipe: "Équipe" }[o];
  return o === "decouverte" ? n : `${n} · jusqu'au ${fr(S.tech.fin_abonnement)}`;
}

function renderAbo() {
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:6px">Abonnement</h1>
  <p class="m" style="margin-bottom:16px">Offre actuelle : <b>${labelOffre()}</b>${S.tech.fondateur ? " · Membre fondateur (prix bloqué à 10 000 FCFA)" : ""}</p>
  <div class="plans">${PLANS.filter(p => !(p.id === "fondateur" && S.tech.fondateur)).map(p => `<div class="plan ${p.hot ? "hot" : ""}"><b>${p.nom}</b><div class="amt">${fcfa(p.prix)}</div>
    <p class="m" style="min-height:40px">${p.detail}</p><button class="btn ${p.hot ? "btn-hot" : "btn-teal"} btn-sm" style="width:100%;margin-top:8px" data-pay="${p.id}">Payer par Mobile Money</button></div>`).join("")}</div>
  <p class="m" style="margin-top:12px">Paiement sécurisé par FedaPay : MTN MoMo, Moov Money, Celtiis Cash. Votre abonnement est activé automatiquement après confirmation.</p>
  <div class="panel" style="margin-top:16px"><h3>Historique des paiements</h3>${S.pays.length ? S.pays.map(p => `<div class="row" style="cursor:default;grid-template-columns:1fr auto auto"><span>${fr(p.created_at)} · ${esc(p.plan)}</span><b>${fcfa(p.montant)}</b><span class="pill ${p.statut === "approuve" ? "p-ok" : p.statut === "echoue" ? "p-bad" : "p-warn"}">${{ approuve: "Payé", echoue: "Échoué", en_attente: "En attente" }[p.statut]}</span></div>`).join("") : `<p class="empty">Aucun paiement.</p>`}</div>`;
  document.querySelectorAll("[data-pay]").forEach(b => b.onclick = () => payer(b.dataset.pay, b));
}

async function payer(plan, btn) {
  btn.disabled = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch("/api/pay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ plan }) });
    const j = await r.json();
    if (!r.ok || !j.url) throw new Error(j.error || "Paiement indisponible pour le moment");
    location.href = j.url;
  } catch (e) { toast(e.message); btn.disabled = false; }
}

async function verifierRetourPaiement() {
  const p = new URLSearchParams(location.search);
  const id = p.get("id"); if (!id) return;
  history.replaceState(null, "", location.pathname + "#abonnement");
  const { data: { session } } = await sb.auth.getSession();
  try {
    const r = await fetch("/api/verify?id=" + encodeURIComponent(id), { headers: { Authorization: "Bearer " + session.access_token } });
    const j = await r.json();
    toast(j.statut === "approuve" ? "Paiement confirmé · abonnement activé" : "Paiement non confirmé pour l'instant");
  } catch { toast("Vérification du paiement impossible, réessayez plus tard"); }
  await loadAll();
}

function renderProfil() {
  const t = S.tech;
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:14px">Profil</h1>
  <div class="grid2"><div class="panel"><h3>Vos informations (affichées sur vos carnets et certificats)</h3>
    <form class="form" id="pf">
      <label>Nom complet<input class="field" name="nom" value="${esc(t.nom)}" required></label>
      <label>Entreprise<input class="field" name="entreprise" value="${esc(t.entreprise)}"></label>
      <label>WhatsApp<input class="field" name="whatsapp" value="${esc(t.whatsapp)}"></label>
      <label>Ville<input class="field" name="ville" value="${esc(t.ville)}"></label>
      <div class="full"><button class="btn btn-hot" type="submit">Enregistrer</button></div></form></div>
  <div class="panel"><h3>Compte</h3><p class="m">${esc(S.user.email)}</p>
    <form class="form" id="pw" style="grid-template-columns:1fr;margin-top:10px"><label>Nouveau mot de passe<input class="field" type="password" name="password" minlength="8" autocomplete="new-password"></label><button class="btn btn-ghost btn-sm" type="submit">Changer le mot de passe</button></form>
    <button class="btn btn-ghost btn-sm" id="out" style="margin-top:14px">Se déconnecter</button>
    <p class="m" style="margin-top:14px">Besoin d'aide ? <a href="https://wa.me/${CFG.WHATSAPP_FROIDPASS}" target="_blank" rel="noopener">WhatsApp FroidPass</a></p></div></div>`;
  document.getElementById("pf").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target));
    const { error } = await sb.from("techniciens").update(o).eq("id", S.user.id);
    if (error) return toast(error.message);
    await loadAll(); toast("Profil enregistré");
  };
  document.getElementById("pw").onsubmit = async ev => {
    ev.preventDefault(); const { error } = await sb.auth.updateUser({ password: new FormData(ev.target).get("password") });
    toast(error ? error.message : "Mot de passe modifié"); ev.target.reset();
  };
  document.getElementById("out").onclick = () => sb.auth.signOut();
}

function renderCert(id) {
  const e = S.eqs.find(x => x.id === id);
  if (!e) { $view.innerHTML = `<p class="empty">Introuvable.</p>`; return; }
  if (!peutRelancer()) { location.hash = "abonnement"; toast("Le certificat PDF est inclus à partir de l'offre Solo"); return; }
  const t = TYPES[e.type], c = client(e.client_id), list = intsOf(e.id);
  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px"><a class="btn btn-ghost btn-sm" href="#eq-${e.id}">← Retour</a><button class="btn btn-hot btn-sm" onclick="print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="cert"><div class="ch"><div><div class="disp" style="font-size:27px;font-weight:800">Certificat d'entretien</div>
    <div class="m">N° FP-${e.code_public.toUpperCase()}-${iso(TODAY).replace(/-/g, "")}</div></div>
    <div style="text-align:right;font-size:14px"><b>${esc(S.tech.entreprise || S.tech.nom)}</b><br>${esc(S.tech.nom)}<br><span class="mono">${esc(S.tech.whatsapp)}</span></div></div>
  <table><tr><th>Client</th><td>${esc(c.nom)}</td><th>Emplacement</th><td>${esc(e.emplacement)}</td></tr>
    <tr><th>Équipement</th><td>${t.label}</td><th>Marque / puissance</th><td>${esc(e.marque)} · ${esc(e.puissance)}</td></tr>
    <tr><th>Fluide</th><td>${esc(e.fluide)}</td><th>Date de pose</th><td>${fr(e.date_pose)}</td></tr>
    <tr><th>Fréquence préventive</th><td>${freq(e)} jours</td><th>Prochaine échéance</th><td>${fr(nextDue(e))}</td></tr></table>
  <h3 style="margin-top:24px;font-size:17px">Historique des interventions</h3>
  <table><tr><th>Date</th><th>Type</th><th>Mesures</th><th>Observations</th></tr>
  ${list.map(x => `<tr><td class="mono">${fr(x.date)}</td><td>${x.type === "preventif" ? "Préventif" : "Curatif"}</td><td class="mono" style="font-size:12px">${[x.hp != null && "HP " + x.hp, x.bp != null && "BP " + x.bp, x.intensite != null && "I " + x.intensite + " A", x.t_soufflage != null && "Ts " + x.t_soufflage + " °C", x.t_reprise != null && "Tr " + x.t_reprise + " °C"].filter(Boolean).join(" · ") || "—"}</td><td>${esc(x.observations)}</td></tr>`).join("") || `<tr><td colspan="4">Aucune intervention</td></tr>`}</table>
  <div class="sig"><div>Le technicien<br><b style="color:var(--ink)">${esc(S.tech.nom)}</b></div><div>Le client<br><b style="color:var(--ink)">${esc(c.contact || c.nom)}</b></div></div>
  <p class="m" style="margin-top:20px">Carnet en ligne : ${esc(publicUrl(e.code_public))} · Généré par FroidPass</p></div>`;
}

function renderLabels() {
  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap"><a class="btn btn-ghost btn-sm" href="#parc">← Retour</a><button class="btn btn-hot btn-sm" onclick="print()">Imprimer les étiquettes</button>
    <span class="m">Format 5 × 5 cm. Imprimez sur vinyle adhésif anti-UV pour les équipements extérieurs.</span></div>
    <div id="labels">${S.eqs.map(e => `<div class="label"><b>${esc(e.emplacement)}</b><div id="lq-${e.id}"></div><span>${esc(S.tech.entreprise || S.tech.nom)} · ${esc(S.tech.whatsapp)}<br>Scannez · FroidPass</span></div>`).join("") || `<p class="empty">Aucun équipement.</p>`}</div>`;
  if (window.QRCode) S.eqs.forEach(e => new QRCode(document.getElementById("lq-" + e.id), { text: publicUrl(e.code_public), width: 110, height: 110, colorDark: "#0b2230", colorLight: "#ffffff" }));
}

function exportCsv() {
  const rows = [["client", "emplacement", "type", "marque", "puissance", "fluide", "environnement", "date_pose", "prochain_entretien", "intervention_date", "intervention_type", "hp", "bp", "intensite", "t_soufflage", "t_reprise", "observations"]];
  for (const e of S.eqs) {
    const base = [client(e.client_id).nom, e.emplacement, TYPES[e.type].label, e.marque, e.puissance, e.fluide, e.environnement, e.date_pose, nextDue(e)];
    const li = intsOf(e.id);
    if (!li.length) rows.push([...base, "", "", "", "", "", "", "", ""]);
    for (const x of li) rows.push([...base, x.date, x.type, x.hp, x.bp, x.intensite, x.t_soufflage, x.t_reprise, x.observations]);
  }
  const csv = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `froidpass-export-${iso(TODAY)}.csv`; a.click();
}

// ---------- Délégation des boutons communs ----------
document.addEventListener("click", e => {
  const r = e.target.closest("[data-relance]"); if (r) relance(r.dataset.relance);
  if (e.target.closest("[data-addeq]")) openAddEq();
});

// ---------- Démarrage ----------
async function start() {
  if (!configured) return route();
  // setTimeout : évite d'appeler Supabase à l'intérieur du rappel d'authentification (blocage connu)
  sb.auth.onAuthStateChange((_ev, session) => setTimeout(() => onSession(session), 0));
}
async function onSession(session) {
  {
    const was = S.user?.id;
    S.user = session?.user || null;
    if (S.user && S.user.id !== was) {
      try { await loadAll(); } catch (e) { toast("Erreur de chargement : " + e.message); }
      await verifierRetourPaiement();
      if (["#connexion", "#inscription", ""].includes(location.hash)) location.hash = "tableau";
    }
    route();
  }
}
start();
