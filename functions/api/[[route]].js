// =====================================================================
// FroidPass — fonctions serveur (Cloudflare Pages Functions)
//   POST /api/pay      : crée une transaction FedaPay et renvoie le lien de paiement
//   GET  /api/verify   : vérifie une transaction au retour du client
//   POST /api/webhook  : notification FedaPay (à configurer dans le tableau de bord)
//
// Variables d'environnement (Cloudflare > Pages > Settings > Variables, en "Secret") :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   FEDAPAY_SECRET_KEY, FEDAPAY_ENV ("sandbox" ou "live"), SITE_URL
// La sécurité ne repose PAS sur le contenu du webhook : on relit toujours
// la transaction chez FedaPay avec la clé secrète avant d'activer un abonnement.
// =====================================================================

const PLANS = {
  fondateur:      { offre: "solo",   montant: 15000,  jours: 90,  fondateur: true, nom: "Membre fondateur (3 mois Solo)" },
  solo_mensuel:   { offre: "solo",   montant: 10000,  jours: 30,  nom: "Solo 1 mois" },
  solo_annuel:    { offre: "solo",   montant: 100000, jours: 365, nom: "Solo 12 mois" },
  pro_mensuel:    { offre: "pro",    montant: 20000,  jours: 30,  nom: "Pro 1 mois" },
  pro_annuel:     { offre: "pro",    montant: 200000, jours: 365, nom: "Pro 12 mois" },
  equipe_mensuel: { offre: "equipe", montant: 40000,  jours: 30,  nom: "Équipe 1 mois" }
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fedaBase = env => env.FEDAPAY_ENV === "live" ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
const unwrap = j => j?.["v1/transaction"] || j?.transaction || j;

async function feda(env, path, method = "GET", body) {
  const r = await fetch(fedaBase(env) + path, {
    method,
    headers: { Authorization: "Bearer " + env.FEDAPAY_SECRET_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("FedaPay " + r.status + " : " + (j.message || JSON.stringify(j).slice(0, 200)));
  return j;
}

async function db(env, path, method = "GET", body, extra = {}) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extra
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Base de données " + r.status + " : " + JSON.stringify(j).slice(0, 200));
  return j;
}

async function currentUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: auth } });
  return r.ok ? r.json() : null;
}

// Active l'abonnement si (et seulement si) FedaPay confirme "approved". Idempotent.
async function settle(env, fedapayId) {
  const rows = await db(env, `paiements?fedapay_id=eq.${Number(fedapayId)}&select=*`);
  const p = rows?.[0];
  if (!p) return { statut: "inconnu" };
  if (p.statut === "approuve") return { statut: "approuve" };

  const tx = unwrap(await feda(env, `/transactions/${Number(fedapayId)}`));
  if (tx.status === "approved") {
    if (Number(tx.amount) !== Number(p.montant)) throw new Error("Montant incohérent");
    // Verrou d'idempotence : on ne passe à "approuve" qu'une seule fois
    const upd = await db(env, `paiements?id=eq.${p.id}&statut=eq.en_attente`, "PATCH", { statut: "approuve" });
    if (!upd?.length) return { statut: "approuve" };
    const plan = PLANS[p.plan];
    const t = (await db(env, `techniciens?id=eq.${p.technicien_id}&select=*`))[0];
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const base = t.fin_abonnement && new Date(t.fin_abonnement) > today && t.offre === plan.offre ? new Date(t.fin_abonnement) : today;
    const fin = new Date(base.getTime() + plan.jours * 864e5).toISOString().slice(0, 10);
    const patch = { offre: plan.offre, fin_abonnement: fin };
    if (plan.fondateur) patch.fondateur = true;
    await db(env, `techniciens?id=eq.${p.technicien_id}`, "PATCH", patch);
    return { statut: "approuve", fin_abonnement: fin };
  }
  if (["declined", "canceled", "refunded"].includes(tx.status)) {
    await db(env, `paiements?id=eq.${p.id}&statut=eq.en_attente`, "PATCH", { statut: "echoue" });
    return { statut: "echoue" };
  }
  return { statut: "en_attente" };
}

export async function onRequest({ request, env, params }) {
  const route = (params.route || []).join("/");
  try {
    for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FEDAPAY_SECRET_KEY", "SITE_URL"])
      if (!env[k]) return json({ error: `Variable ${k} manquante côté serveur` }, 500);

    if (route === "pay" && request.method === "POST") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Connexion requise" }, 401);
      const { plan } = await request.json().catch(() => ({}));
      const P = PLANS[plan];
      if (!P) return json({ error: "Offre inconnue" }, 400);
      const tech = (await db(env, `techniciens?id=eq.${user.id}&select=*`))[0];
      if (plan === "fondateur" && tech?.fondateur) return json({ error: "Offre fondateur déjà utilisée" }, 400);

      const nom = (tech?.nom || "Technicien").trim().split(/\s+/);
      const tx = unwrap(await feda(env, "/transactions", "POST", {
        description: `FroidPass — ${P.nom}`,
        amount: P.montant,
        currency: { iso: "XOF" },
        callback_url: env.SITE_URL.replace(/\/$/, "") + "/app.html",
        customer: { firstname: nom[0], lastname: nom.slice(1).join(" ") || nom[0], email: user.email }
      }));
      await db(env, "paiements", "POST", { technicien_id: user.id, fedapay_id: tx.id, plan, montant: P.montant });
      const tok = await feda(env, `/transactions/${tx.id}/token`, "POST");
      return json({ url: tok.url });
    }

    if (route === "verify" && request.method === "GET") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Connexion requise" }, 401);
      const id = new URL(request.url).searchParams.get("id");
      const rows = await db(env, `paiements?fedapay_id=eq.${Number(id)}&technicien_id=eq.${user.id}&select=id`);
      if (!rows?.length) return json({ statut: "inconnu" }, 404);
      return json(await settle(env, id));
    }

    if (route === "webhook" && request.method === "POST") {
      const ev = await request.json().catch(() => ({}));
      const id = ev?.entity?.id || ev?.data?.id || ev?.id;
      if (id) await settle(env, id);
      return json({ ok: true });
    }

    return json({ error: "Route inconnue" }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
