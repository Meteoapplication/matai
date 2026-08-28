/**
 * Mata'i — LES MESURES RÉELLES.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TOUT LE RESTE DE CETTE APPLICATION EST UNE PRÉVISION.
 *
 * Open-Meteo, ECMWF, MFWAM : ce sont des modèles. Ils calculent ce que
 * l'atmosphère devrait faire. Ils sont bons, et ils se trompent.
 *
 * Ce fichier va chercher la seule chose qui ne soit pas une opinion : un
 * anémomètre qui tourne, et ce qu'il a mesuré. Les aéroports publient
 * leurs relevés toutes les demi-heures sous forme de METAR — un format
 * télégraphique conçu pour les pilotes, lisible depuis 1968.
 *
 *     METAR NTAA 272000Z AUTO VRB02KT CAVOK 26/20 Q1018 NOSIG
 *
 * ⚠️  UNE SEULE STATION POUR TOUTE LA POLYNÉSIE.
 *
 * Relevé le 27 août 2026 sur le service d'aviationweather.gov, en
 * interrogeant les neuf codes OACI du territoire, puis toute l'emprise
 * −30…−5° de latitude et −155…−130° de longitude : une seule station
 * répond, NTAA, Tahiti-Faa'a. Bora Bora (NTTB), Rangiroa (NTTG), Nuku
 * Hiva (NTMD) et les autres ne publient pas sur ce flux.
 *
 * Ça n'est pas un manque à combler avec de l'à-peu-près. Pour Tahiti,
 * c'est la mesure de l'île. Pour Rangiroa, à mille kilomètres, ce n'est
 * rien du tout — et l'afficher quand même sous le titre « conditions
 * actuelles » serait précisément le mensonge que ce projet refuse.
 *
 * La station voyage donc avec sa DISTANCE, et l'application décide (voir
 * `src/provenance.js`, MESURE_PROCHE_KM) si elle a le droit de l'appeler
 * la mesure du lieu. Les autres îles affichent une prévision, en le disant.
 * ═══════════════════════════════════════════════════════════════════════
 */

const SERVICE = 'https://aviationweather.gov/api/data/metar';

/** Les stations connues, avec leur position exacte (donnée par le service). */
export const STATIONS = [
  { oaci: 'NTAA', nom: 'Tahiti-Faa’a', lat: -17.554, lon: -149.607 }
];

/**
 * Codes interrogés à chaque passage. On garde les huit muettes : le jour
 * où l'une se met à publier, elle arrive toute seule. Les redemander ne
 * coûte rien — c'est la même requête.
 */
const CODES = [
  'NTAA', // Tahiti-Faa'a — la seule qui réponde à ce jour
  'NTTB', // Bora Bora, Motu Mute
  'NTTM', // Moorea, Temae
  'NTTR', // Raiatea, Uturoa
  'NTTG', // Rangiroa
  'NTGF', // Fakarava
  'NTMD', // Nuku Hiva, Nuku Ataha
  'NTAT', // Tubuai, Mataura
  'NTGJ'  // Gambier, Totegegie
];

/** Nombre d'heures d'historique demandées : la courbe en réclame douze. */
const HEURES = 14;

const R_TERRE = 6371;

/** Distance en kilomètres entre deux points, à vol d'oiseau. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.sqrt(a));
}

/**
 * Lit un relevé du service.
 *
 * ⚠️  « VRB » N'EST PAS UNE DIRECTION.
 *
 * Quand le vent est faible et tourne, le METAR écrit `VRB` au lieu d'un
 * cap. C'est une information — « il n'y a pas de direction établie » — et
 * ce n'est pas zéro degré. Convertir `VRB` en 0 planterait une aiguille
 * plein nord sur la rose des vents alors que le vent tourne : un chiffre
 * inventé, affiché avec l'autorité d'une mesure.
 *
 * On renvoie donc `dir: null` et `variable: true`, et la rose s'abstient.
 */
export function lireReleve(e) {
  if (!e || typeof e.wspd !== 'number') return null;

  const variable = e.wdir === 'VRB' || e.wdir === 'vrb';
  const dir = variable ? null
    : (typeof e.wdir === 'number' ? ((e.wdir % 360) + 360) % 360 : null);

  const t = e.reportTime
    ? new Date(e.reportTime)
    : (typeof e.obsTime === 'number' ? new Date(e.obsTime * 1000) : null);
  if (!t || isNaN(t.getTime())) return null;

  return {
    t: t.toISOString().slice(0, 16) + 'Z',
    vent: Math.round(e.wspd * 10) / 10,          // le METAR est déjà en nœuds
    rafale: typeof e.wgst === 'number' ? Math.round(e.wgst) : null,
    dir,
    variable,
    temp: typeof e.temp === 'number' ? Math.round(e.temp * 10) / 10 : null,
    pression: typeof e.altim === 'number' ? Math.round(e.altim) : null,
    brut: typeof e.rawOb === 'string' ? e.rawOb : null
  };
}

/**
 * Va chercher les relevés des dernières heures.
 *
 * En cas d'échec on renvoie `null`, jamais un objet vide : l'absence de
 * mesure doit se voir comme une absence, pas comme un calme plat.
 */
export async function recuperer(fetchImpl = fetch) {
  const url = SERVICE + '?format=json&hours=' + HEURES + '&ids=' + CODES.join(',');

  let brut;
  try {
    const r = await fetchImpl(url, {
      headers: { 'User-Agent': 'matai (application meteo Polynesie francaise)' }
    });
    if (!r.ok) return { erreur: 'HTTP ' + r.status, stations: [] };
    brut = await r.json();
  } catch (e) {
    return { erreur: String((e && e.message) || e), stations: [] };
  }

  if (!Array.isArray(brut)) return { erreur: 'réponse inattendue', stations: [] };

  // Regrouper par station, du plus ancien au plus récent.
  const par = new Map();
  for (const e of brut) {
    const code = e && e.icaoId;
    if (!code) continue;
    const r = lireReleve(e);
    if (!r) continue;
    if (!par.has(code)) {
      par.set(code, {
        oaci: code,
        nom: nommer(code, e),
        lat: typeof e.lat === 'number' ? e.lat : null,
        lon: typeof e.lon === 'number' ? e.lon : null,
        releves: []
      });
    }
    par.get(code).releves.push(r);
  }

  const stations = [...par.values()];
  for (const st of stations) {
    st.releves.sort((a, b) => a.t.localeCompare(b.t));
    // Deux relevés de la même minute arrivent parfois en double.
    st.releves = st.releves.filter((r, i, l) => i === 0 || r.t !== l[i - 1].t);
  }

  return { erreur: null, stations, releveA: new Date().toISOString() };
}

/** Le nom lisible d'une station : le nôtre s'il existe, sinon celui du service. */
function nommer(code, e) {
  const connue = STATIONS.find((s) => s.oaci === code);
  if (connue) return connue.nom;
  const brut = (e && e.name) || code;
  // « Tahiti Island/Faaa Intl, WI, PF » → « Tahiti Island/Faaa Intl »
  return String(brut).split(',')[0];
}

/**
 * La mesure à joindre au paquet d'une île : la station la plus proche,
 * sa distance, son dernier relevé et l'historique pour la courbe.
 *
 * On joint la station même quand elle est LOIN. C'est volontaire :
 * l'application préfère écrire « la station la plus proche est à 1 100 km »
 * plutôt que de ne rien dire, parce que le silence se lit comme une panne
 * alors que c'est une réalité géographique du territoire.
 */
export function pourIle(mesures, ile) {
  if (!mesures || !Array.isArray(mesures.stations) || !mesures.stations.length) {
    return { station: null, erreur: (mesures && mesures.erreur) || 'aucune station' };
  }
  if (typeof ile.lat !== 'number' || typeof ile.lon !== 'number') {
    return { station: null, erreur: 'île sans position' };
  }

  let meilleure = null;
  let meilleurD = Infinity;
  for (const st of mesures.stations) {
    if (typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;
    if (!st.releves.length) continue;
    const d = distanceKm(ile.lat, ile.lon, st.lat, st.lon);
    if (d < meilleurD) { meilleurD = d; meilleure = st; }
  }
  if (!meilleure) return { station: null, erreur: 'aucune station exploitable' };

  const releves = meilleure.releves.slice(-Math.round(HEURES * 2));
  return {
    station: { oaci: meilleure.oaci, nom: meilleure.nom, lat: meilleure.lat, lon: meilleure.lon },
    distanceKm: Math.round(meilleurD * 10) / 10,
    dernier: releves[releves.length - 1] || null,
    releves,
    erreur: null
  };
}
