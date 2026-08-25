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
 * CE QUI RESTE À CONFIRMER — à faire avant de s'appuyer dessus
 *
 * Le produit « Vigilance Outre-Mer » de Météo-France liste bien la
 * Polynésie française, sous Licence Ouverte Etalab 2.0, gratuitement. Mais
 * deux points n'ont pas pu être vérifiés :
 *
 *   a) le format exact pour l'outre-mer — PDF seul, ou XML structuré comme
 *      en métropole. Un PDF serait un frein sérieux et demanderait une
 *      autre approche.
 *   b) si l'API « Bulletin Vigilance » du portail couvre la Polynésie : sa
 *      documentation parle de « départements », ce qui laisse un doute.
 *
 * Pour lever le doute : créer un compte gratuit sur
 * portail-api.meteofrance.fr, générer une clé, la poser dans la variable
 * d'environnement METEOFRANCE_CLE, et lancer `node build.mjs`. Le script
 * dira exactement ce qu'il a reçu.
 *
 * Tant que la clé est absente, tout fonctionne — en état « inconnu ».
 * ─────────────────────────────────────────────────────────────────────
 */

const CLE = process.env.METEOFRANCE_CLE || '';
const LIEN = 'https://meteo.pf/fr/vigilance';
const SOURCE = 'Météo-France Polynésie française';

/** Les six niveaux officiels en Polynésie. Le violet et le gris sont
 *  propres à l'outre-mer : phases d'impact cyclonique majeur. */
const NIVEAUX = {
  1: 'vert',
  2: 'jaune',
  3: 'orange',
  4: 'rouge',
  5: 'violet',
  6: 'gris'
};

/** L'état par défaut : on ne sait pas, et on le dit. */
export function inconnu(raison) {
  return {
    etat: 'inconnu',
    zone: null,
    phenomenes: [],
    maj: null,
    source: SOURCE,
    lien: LIEN,
    raison: raison || 'non récupérée'
  };
}

/**
 * Rattache une île à sa zone de vigilance.
 * Météo-France découpe la Polynésie en zones qui ne suivent pas les îles
 * une à une : c'est l'archipel qui porte l'alerte.
 */
export function zonePour(ile) {
  const parArchipel = {
    'Îles du Vent': 'Îles du Vent',
    'Îles Sous-le-Vent': 'Îles Sous-le-Vent',
    'Tuamotu': 'Tuamotu Ouest',
    'Marquises': 'Marquises',
    'Australes': 'Australes',
    'Gambier': 'Gambier'
  };
  return parArchipel[ile.archipel] || null;
}

/**
 * Interroge le portail Météo-France.
 * Renvoie toujours un objet exploitable : en cas de doute, « inconnu ».
 */
export async function recuperer(ile) {
  if (!CLE) {
    return inconnu('aucune clé Météo-France configurée');
  }

  const zone = zonePour(ile);
  if (!zone) {
    return inconnu(`archipel sans zone de vigilance connue : ${ile.archipel}`);
  }

  try {
    const r = await fetch(
      'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours',
      {
        headers: { apikey: CLE, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!r.ok) {
      return inconnu(`le portail a répondu HTTP ${r.status}`);
    }

    const brut = await r.json();
    const lu = interpreter(brut, zone);

    if (!lu) {
      // Le portail a répondu, mais pas dans une forme qu'on sait lire.
      // C'est exactement le cas où il ne faut surtout pas deviner.
      return inconnu('réponse reçue mais format non reconnu pour la Polynésie');
    }

    return lu;
  } catch (e) {
    return inconnu(`échec réseau : ${(e && e.message) || e}`);
  }
}

/**
 * Extrait la zone qui nous intéresse d'une réponse du portail.
 *
 * ⚠️ Cette fonction est écrite d'après la forme documentée de l'API
 * métropole. Elle N'A PAS été validée sur une réponse outre-mer réelle.
 * Si la forme diffère, elle renvoie null — et l'app affiche « inconnu »
 * plutôt qu'une couleur inventée. C'est voulu.
 */
function interpreter(brut, zone) {
  try {
    const produit = brut && (brut.product || brut.produit);
    if (!produit) return null;

    const domaines =
      produit.periods ||
      produit.text_bloc_items ||
      produit.domain_ids ||
      null;
    if (!Array.isArray(domaines)) return null;

    const cherche = zone.toLowerCase();
    let trouve = null;

    for (const d of domaines) {
      const nom = String(d.domain_name || d.domain_id || d.nom || '').toLowerCase();
      if (nom && cherche.includes(nom.slice(0, 8))) { trouve = d; break; }
      if (nom && nom.includes(cherche.slice(0, 8))) { trouve = d; break; }
    }
    if (!trouve) return null;

    const niveau = Number(
      trouve.max_color_id ?? trouve.color_id ?? trouve.niveau ?? NaN
    );
    const etat = NIVEAUX[niveau];
    if (!etat) return null;

    const phenomenes = Array.isArray(trouve.phenomenon_items)
      ? trouve.phenomenon_items
          .filter((p) => Number(p.phenomenon_max_color_id ?? 1) > 1)
          .map((p) => String(p.phenomenon_name || p.phenomenon_id))
      : [];

    return {
      etat,
      zone,
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
