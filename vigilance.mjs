/**
 * Mata'i — la vigilance officielle de Météo-France.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LA RÈGLE QUI GOUVERNE TOUT CE FICHIER
 *
 * On ne dit JAMAIS « vert » quand on ne sait pas.
 *
 * Une app qui affiche une vigilance verte alors que Météo-France est passé
 * en orange vagues-submersion est pire qu'une app qui n'affiche rien : elle
 * rassure à tort. Toute erreur, tout doute, toute panne de réseau ramène
 * donc à l'état « inconnu », qui s'affiche en gris avec un renvoi vers
 * meteo.pf — jamais en vert.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Deux règles de licence à respecter, tirées des droits de reproduction de
 * Météo-France :
 *   1. la vigilance se reprend INTÉGRALEMENT et SANS MODIFICATION
 *   2. elle est horodatée et créditée, avec un lien vers la source
 * C'est à la fois la condition de réutilisation et la meilleure protection
 * juridique : on ne réinterprète pas une alerte de sécurité, on la relaie.
 *
 * ─────────────────────────────────────────────────────────────────────
 * CE FICHIER A ÉTÉ ÉCRIT DEUX FOIS
 *
 * La première version devinait le format d'après la documentation
 * MÉTROPOLE, faute de mieux, et le disait. Elle se trompait : la structure
 * réelle n'est pas celle-là, et les zones ne portent pas les noms qu'on
 * cherchait.
 *
 * Le 26 août, Météo-France a répondu au courriel de Gabin en joignant deux
 * documents. Ce fichier est maintenant écrit d'après eux, et d'après la
 * liste des ressources publiée sur le portail :
 *
 *   — « Descriptif technique des informations OUTRE-MER », qui donne le
 *     format JSON, les identifiants de zone, de phénomène et de niveau ;
 *   — la page de l'API « DonneesPubliquesVigilance », qui expose des
 *     points d'entrée DÉDIÉS à la Polynésie.
 *
 * ⚠️  Le second document reçu (« doc_vigilance_258 », fichier NXFR33) ne
 * s'applique PAS : il décrit le flux XML, et précise lui-même que « le
 * fichier NXFR33_LFPW mis à la disposition des usagers dans ce flux ne
 * porte que sur la Métropole ». Il ne sert ici qu'à une chose : sa liste
 * de zones outre-mer est plus complète que celle du descriptif, et c'est
 * de lui que viennent les zones des Australes.
 *
 * RÉPONSE AUX DEUX QUESTIONS POSÉES :
 *   1. Oui, l'API couvre la Polynésie — par des routes qui lui sont propres.
 *   2. En JSON structuré, pas seulement en PDF.
 * ─────────────────────────────────────────────────────────────────────
 * CE QUI MANQUE ENCORE : LA CLÉ
 *
 * Rien de tout cela ne fonctionne sans une clé du portail des API, et la
 * création de compte échouait. La réponse de Météo-France donne la marche
 * à suivre : activer le compte par le lien du courriel de confirmation, se
 * connecter avec l'IDENTIFIANT choisi et non l'adresse mail, et vider le
 * cache du navigateur en cas de message « Suspicious authentication
 * attempts found ».
 *
 * Tant que METEOFRANCE_CLE est absente, tout fonctionne — en « inconnu ».
 * ─────────────────────────────────────────────────────────────────────
 */

const CLE = process.env.METEOFRANCE_CLE || '';
const LIEN = 'https://meteo.pf/fr/vigilance';
const SOURCE = 'Météo-France Polynésie française';

/** Les routes dédiées à la Polynésie, relevées sur la page de l'API. */
const BASE = 'https://public-api.meteofrance.fr/public/DPVigilance/v1';
const CARTE = `${BASE}/polynesie/cartevigilance/encours`;

/**
 * Les niveaux, tels que le descriptif outre-mer les définit pour la
 * Polynésie : quatre valeurs, pas davantage.
 *
 * Les codes 5 à 9 (violet, gris, sépia, orange et rouge hachurés) existent
 * dans le système métropolitain et sont repris ici par prudence : si l'un
 * d'eux arrivait un jour sur la Polynésie, il vaut infiniment mieux
 * l'afficher que de le prendre pour une valeur inconnue — et un code
 * inconnu, lui, ne devient jamais vert.
 */
const NIVEAUX = {
  1: 'vert',
  2: 'jaune',
  3: 'orange',
  4: 'rouge',
  5: 'violet',
  6: 'gris',
  7: 'sépia',
  8: 'orange',
  9: 'rouge'
};

/** Les quatre phénomènes suivis en Polynésie. */
const PHENOMENES = {
  1: 'vent',
  2: 'fortes pluies',
  3: 'orages',
  11: 'fortes houles'
};

/**
 * Les zones de vigilance de la Polynésie.
 *
 * Le descriptif outre-mer en liste quatorze ; le document NXFR33 en liste
 * dix-sept, avec les Australes et Rapa que le premier oublie. On prend
 * l'union des deux — un archipel absent de la table serait un archipel
 * sans alerte.
 *
 * Les deux documents numérotent différemment le même découpage :
 * « VIGI987-13 » chez l'un, « 987-213 » chez l'autre. C'est la forme
 * VIGI987-NN qu'emploient les fichiers JSON, donc c'est celle-ci.
 */
const ZONES = {
  'VIGI987':    'Polynésie française',
  'VIGI987-01': 'Marquises Nord',
  'VIGI987-02': 'Marquises Sud',
  'VIGI987-03': 'Tuamotu Nord Est',
  'VIGI987-04': 'Tuamotu Nord Ouest',
  'VIGI987-05': 'Tuamotu Centre Nord',
  'VIGI987-06': 'Tuamotu Centre',
  'VIGI987-07': 'Tuamotu Centre Sud',
  'VIGI987-08': 'Tuamotu Est',
  'VIGI987-09': 'Tuamotu Sud',
  'VIGI987-10': 'Gambier',
  'VIGI987-11': 'Tuamotu Ouest',
  'VIGI987-12': 'Mopelia',
  'VIGI987-13': 'Îles Sous-le-Vent',
  'VIGI987-14': 'Îles du Vent',
  'VIGI987-15': 'Australes Ouest',
  'VIGI987-16': 'Australes Centre',
  'VIGI987-17': 'Rapa'
};

/**
 * Quelle zone pour quelle île.
 *
 * ⚠️  ON NE DEVINE PAS UN DÉCOUPAGE DE SÉCURITÉ.
 *
 * Certaines correspondances sont certaines : Tahiti et Moorea sont les
 * Îles du Vent, Bora Bora et Raiatea les Îles Sous-le-Vent, Mangareva les
 * Gambier, Nuku Hiva les Marquises Nord. Elles sont posées ici.
 *
 * D'autres ne le sont pas. Les Tuamotu comptent NEUF zones, et rien dans
 * la documentation reçue ne dit laquelle contient Rangiroa ou Fakarava —
 * seulement des noms de secteurs sans limites géographiques. Plutôt que
 * de parier, ces îles retombent sur le domaine global VIGI987, qui couvre
 * toute la Polynésie : moins précis, mais jamais faux. Le champ `precise`
 * dit laquelle des deux situations s'applique, et l'application peut le
 * signaler.
 *
 * À corriger le jour où on obtient les limites des zones — auprès de
 * Météo-France Polynésie, pas par déduction sur une carte.
 */
const PAR_ILE = {
  'tahiti':     { zone: 'VIGI987-14', precise: true },
  'moorea':     { zone: 'VIGI987-14', precise: true },
  'bora-bora':  { zone: 'VIGI987-13', precise: true },
  'raiatea':    { zone: 'VIGI987-13', precise: true },
  'nuku-hiva':  { zone: 'VIGI987-01', precise: true },
  'gambier':    { zone: 'VIGI987-10', precise: true },

  // Découpage interne inconnu : on prend le domaine global.
  'rangiroa':   { zone: 'VIGI987', precise: false },
  'fakarava':   { zone: 'VIGI987', precise: false },
  'tubuai':     { zone: 'VIGI987', precise: false }
};

/** L'état par défaut : on ne sait pas, et on le dit. */
export function inconnu(raison) {
  return {
    etat: 'inconnu',
    zone: null,
    zoneId: null,
    precise: null,
    phenomenes: [],
    maj: null,
    source: SOURCE,
    lien: LIEN,
    raison: raison || 'non récupérée'
  };
}

/**
 * Rattache une île à sa zone de vigilance.
 * @returns {{zone:string, precise:boolean}|null}
 */
export function zonePour(ile) {
  const id = ile && (ile.id || ile.ile);
  if (id && PAR_ILE[id]) return PAR_ILE[id];

  // Île inconnue du registre : le domaine global reste juste.
  return { zone: 'VIGI987', precise: false };
}

/**
 * Interroge le portail Météo-France.
 * Renvoie toujours un objet exploitable : en cas de doute, « inconnu ».
 */
export async function recuperer(ile) {
  if (!CLE) {
    return inconnu('aucune clé Météo-France configurée');
  }

  const z = zonePour(ile);

  try {
    const r = await fetch(CARTE, {
      headers: { apikey: CLE, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (!r.ok) {
      return inconnu(`le portail a répondu HTTP ${r.status}`);
    }

    const brut = await r.json();
    const lu = interpreter(brut, z);

    if (!lu) {
      // Le portail a répondu, mais pas dans une forme qu'on sait lire.
      // C'est exactement le cas où il ne faut surtout pas deviner.
      return inconnu('réponse reçue mais zone introuvable dans le fichier');
    }

    return lu;
  } catch (e) {
    return inconnu(`échec réseau : ${(e && e.message) || e}`);
  }
}

/**
 * Extrait la zone qui nous intéresse du fichier « carte ».
 *
 * Structure documentée :
 *   product.update_time
 *   product.timelaps.domain_ids[] → { domain_id, max_color_id,
 *                                     phenomenon_items[] → { phenomenon_id,
 *                                       phenomenon_max_color_id } }
 */
export function interpreter(brut, z) {
  try {
    const produit = brut && (brut.product || brut.produit || brut);
    const domaines = produit
      && produit.timelaps
      && produit.timelaps.domain_ids;
    if (!Array.isArray(domaines)) return null;

    const cherche = (id) => domaines.find(
      (d) => String(d && d.domain_id).toUpperCase() === String(id).toUpperCase()
    );

    // La zone de l'île d'abord ; à défaut le domaine global, qui existe
    // toujours. Si le fichier ne contient ni l'un ni l'autre, on ne sait
    // pas — et on le dit plutôt que de renvoyer la première zone venue.
    let trouve = cherche(z.zone);
    let zoneId = z.zone;
    let precise = z.precise;

    if (!trouve && z.zone !== 'VIGI987') {
      trouve = cherche('VIGI987');
      zoneId = 'VIGI987';
      precise = false;
    }
    if (!trouve) return null;

    const niveau = Number(trouve.max_color_id);
    const etat = NIVEAUX[niveau];
    if (!etat) return null;

    // On ne retient que les phénomènes réellement en alerte : au niveau 1
    // tout est vert et les lister n'apprendrait rien.
    const phenomenes = Array.isArray(trouve.phenomenon_items)
      ? trouve.phenomenon_items
          .filter((p) => Number(p && p.phenomenon_max_color_id) > 1)
          .map((p) => ({
            nom: PHENOMENES[Number(p.phenomenon_id)] || `phénomène ${p.phenomenon_id}`,
            etat: NIVEAUX[Number(p.phenomenon_max_color_id)] || 'inconnu'
          }))
      : [];

    return {
      etat,
      zone: ZONES[zoneId] || zoneId,
      zoneId,
      // false = la vigilance affichée est celle de toute la Polynésie,
      // faute de connaître la zone exacte de cette île. L'application le
      // signale : une alerte trop large reste vraie, mais l'utilisateur
      // doit savoir qu'elle n'est pas taillée pour son lagon.
      precise,
      phenomenes,
      maj: produit.update_time || produit.begin_validity_time || null,
      source: SOURCE,
      lien: LIEN,
      raison: null
    };
  } catch (e) {
    return null;
  }
}
