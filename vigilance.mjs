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

/**
 * ⚠️  « polynésie » OU « polynesie » — ON NE PARIE PAS, ON ESSAIE LES DEUX.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Ce chemin était écrit `polynesie`, sans accent, d'après les documents
 * envoyés par Météo-France. Le 28 août, la page de l'API sur le portail
 * l'affiche avec un accent :
 *
 *     OBTENIR  /polynésie /cartevigilance /encours
 *
 * Une lettre d'écart, et l'appel répond 404. La vigilance resterait donc
 * grise sur tous les écrans AVEC une clé valide, et le message dirait « le
 * portail a répondu HTTP 404 » — juste, mais on chercherait la faute du
 * côté de la clé, qui vient d'être posée, plutôt que du côté d'un accent.
 *
 * Impossible de trancher sans clé, et deviner serait exactement ce que ce
 * fichier s'interdit ailleurs. On essaie donc les deux graphies, dans
 * l'ordre où le portail les présente, et on garde la première qui répond.
 * `fetch` encode l'accent en `%C3%A9` tout seul.
 *
 * ⚠️  TRANCHÉ LE 28 AOÛT : C'EST LA GRAPHIE SANS ACCENT.
 *
 * Gabin a lancé l'appel depuis le portail lui-même, avec sa clé. Le
 * portail AFFICHE le chemin accentué dans son sommaire, et ENVOIE :
 *
 *     https://public-api.meteofrance.fr/public/DPVigilance/v1
 *       /polynesie/cartevigilance/encours          → HTTP 200
 *
 * L'accent n'est donc qu'un habillage de leur documentation. On met la
 * graphie confirmée en premier ; l'autre reste derrière, sans coût — elle
 * ne part que si la première échoue en 404, c'est-à-dire le jour où ils
 * changeraient d'avis.
 * ═══════════════════════════════════════════════════════════════════════
 */
const CHEMINS = [
  `${BASE}/polynesie/cartevigilance/encours`,
  `${BASE}/polynésie/cartevigilance/encours`
];

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
/**
 * ⚠️  LE NUMÉRO 9 MANQUAIT, ET C'EST CELUI DE LA HOULE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Cette table venait du descriptif outre-mer. Le premier appel réel, le
 * 28 août, a montré autre chose : le flux polynésien ne porte JAMAIS le
 * numéro 11, et porte partout le numéro 9. Chaque zone principale liste
 * exactement quatre phénomènes — 1, 2, 3 et 9 — et c'est le 9 qui était
 * orange sur Rapa ce jour-là.
 *
 * Sans lui, l'écran aurait écrit « phénomène 9 orange » sur la ligne la
 * plus importante de l'application.
 *
 * COMMENT LE 9 A ÉTÉ IDENTIFIÉ — trois indices qui concordent, et aucun
 * n'est une supposition isolée :
 *
 *   1. le flux liste quatre phénomènes par zone ; trois sont connus (vent,
 *      fortes pluies, orages) ; le quatrième est donc le marin, seul
 *      manquant des quatre que Météo-France suit en Polynésie ;
 *   2. la numérotation de Météo-France attribue le 9 aux vagues-submersion ;
 *   3. le jour de cet appel, la presse polynésienne et les communiqués du
 *      haut-commissariat plaçaient Rapa en vigilance orange
 *      VAGUE-SUBMERSION — exactement la zone et le niveau que le flux
 *      donne au phénomène 9.
 *
 * Ce n'est pas une confirmation de Météo-France. À leur demander, et à
 * corriger ici si leur réponse diffère. Le 11 est conservé : s'il arrivait
 * un jour, mieux vaut un nom qu'un numéro.
 * ═══════════════════════════════════════════════════════════════════════
 */
const PHENOMENES = {
  1: 'vent',
  2: 'fortes pluies',
  3: 'orages',
  9: 'vagues-submersion',
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
  // `PAR_ILE[id]` seul suffisait tant que `id` vient de spots.json. Mais la
  // même forme a produit une vraie faute côté application (voir
  // BandeauVigilance.js) : tout objet hérite de `toString`, donc
  // `PAR_ILE['toString']` est une fonction, donc vrai — et on aurait rendu
  // une « zone » sans champ `zone`, dans le fichier qui décide d'une
  // alerte de sécurité. On demande si la clé est là, pas si la lecture
  // rend quelque chose de vrai.
  if (id && Object.prototype.hasOwnProperty.call(PAR_ILE, id)) return PAR_ILE[id];

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
  const ennuis = [];

  for (const url of CHEMINS) {
    let r;
    try {
      r = await fetch(url, {
        headers: { apikey: CLE, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
    } catch (e) {
      ennuis.push(`échec réseau : ${(e && e.message) || e}`);
      continue;
    }

    // 404 : ce n'est pas la bonne graphie du chemin, on essaie l'autre.
    // Tout autre code d'erreur porte sur la clé ou sur le service, et
    // réessayer une seconde adresse n'y changerait rien — on s'arrête et on
    // le dit, plutôt que de brouiller le diagnostic.
    if (r.status === 404) {
      ennuis.push('404 sur ' + chemin(url));
      continue;
    }
    if (!r.ok) {
      return inconnu(`le portail a répondu HTTP ${r.status}`);
    }

    let brut;
    try {
      brut = await r.json();
    } catch (e) {
      return inconnu('réponse illisible : ' + ((e && e.message) || e));
    }

    const lu = interpreter(brut, z);
    if (!lu) {
      // Le portail a répondu, mais pas dans une forme qu'on sait lire.
      // C'est exactement le cas où il ne faut surtout pas deviner.
      return inconnu('réponse reçue mais zone introuvable dans le fichier');
    }

    // On garde la trace de l'adresse qui a marché : c'est elle qui tranche
    // la question de l'accent, et le journal du passage la montrera.
    return { ...lu, chemin: chemin(url) };
  }

  return inconnu(ennuis.join(' ; ') || 'aucune adresse n’a répondu');
}

/** La fin d'une URL, pour le journal — sans le nom d'hôte ni la clé. */
function chemin(url) {
  const i = url.indexOf('/DPVigilance');
  return i === -1 ? url : url.slice(i);
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

    // ═══════════════════════════════════════════════════════════════════
    // ⚠️  UNE ZONE PEUT AVOIR DES SOUS-ZONES, ET ELLES COMPTENT.
    //
    // Le premier appel réel a montré treize domaines que la documentation
    // ne mentionnait nulle part : VIGI987-14-50 à -63, tous rattachés aux
    // Îles du Vent, et tous ne portant QUE le phénomène 9
    // (vagues-submersion). Ce sont selon toute apparence des secteurs
    // côtiers — la submersion dépend de l'orientation du rivage, pas le
    // vent ni la pluie, qui restent à l'échelle de l'archipel.
    //
    // Le jour du relevé, la zone mère et ses treize secteurs étaient tous
    // au vert : impossible d'en déduire si la mère agrège ses secteurs ou
    // si elle les ignore. Or les deux cas ne se valent pas du tout — si
    // elle les ignore, un secteur de Tahiti passé en orange submersion
    // n'apparaîtrait NULLE PART dans l'application.
    //
    // On prend donc le maximum de la zone et de ses sous-zones. Ce n'est
    // pas une supposition : `VIGI987-14-57` est par construction une
    // subdivision de `VIGI987-14`, son alerte est donc une alerte des Îles
    // du Vent. Si la mère agrège déjà, ce calcul ne change rien ; si elle
    // n'agrège pas, il évite un silence sur une alerte de submersion.
    //
    // Et l'écart va toujours dans le même sens : ça peut monter le niveau,
    // jamais le descendre.
    // ═══════════════════════════════════════════════════════════════════
    const prefixe = String(zoneId).toUpperCase() + '-';
    const sousZones = domaines.filter(
      (d) => String(d && d.domain_id).toUpperCase().startsWith(prefixe)
    );

    const niveau = Math.max(
      Number(trouve.max_color_id) || 0,
      ...sousZones.map((d) => Number(d.max_color_id) || 0)
    );
    const etat = NIVEAUX[niveau];
    if (!etat) return null;

    // On ne retient que les phénomènes réellement en alerte : au niveau 1
    // tout est vert et les lister n'apprendrait rien.
    //
    // Les phénomènes suivent la même règle que le niveau : on prend le pire
    // de la zone et de ses sous-zones. Sans ça, l'écran pourrait afficher
    // « ORANGE » sans pouvoir dire de quoi — le niveau viendrait d'un
    // secteur côtier et la liste des phénomènes, elle, resterait celle de
    // la zone mère, donc vide.
    const pire = new Map();
    for (const d of [trouve, ...sousZones]) {
      for (const p of (Array.isArray(d.phenomenon_items) ? d.phenomenon_items : [])) {
        const id = Number(p && p.phenomenon_id);
        const n = Number(p && p.phenomenon_max_color_id);
        if (!isFinite(id) || !(n > 1)) continue;
        if (!pire.has(id) || n > pire.get(id)) pire.set(id, n);
      }
    }

    const nommerPhenomene = (id) =>
      (Object.prototype.hasOwnProperty.call(PHENOMENES, id)
        ? PHENOMENES[id] : `phénomène ${id}`);

    const phenomenes = [...pire.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([id, n]) => ({
        nom: nommerPhenomene(id),
        etat: NIVEAUX[n] || 'inconnu'
      }));

    return {
      etat,
      zone: ZONES[zoneId] || zoneId,
      zoneId,
      // false = la vigilance affichée est celle de toute la Polynésie,
      // faute de connaître la zone exacte de cette île. L'application le
      // signale : une alerte trop large reste vraie, mais l'utilisateur
      // doit savoir qu'elle n'est pas taillée pour son lagon.
      precise,
      // Quelles zones nommées portent réellement l'alerte, quand on affiche
      // celle de tout le territoire. Voir `zonesEnAlerte` plus bas.
      causes: precise === false ? zonesEnAlerte(domaines) : null,
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

/**
 * QUELLES ZONES PORTENT VRAIMENT L'ALERTE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  « MOINS PRÉCIS » ET « ALARMISTE » NE SONT PAS LA MÊME CHOSE.
 *
 * Trois îles — Rangiroa, Fakarava, Tubuai — n'ont pas de zone connue et
 * retombent sur le domaine `VIGI987`, qui couvre toute la Polynésie. On
 * l'avait écrit comme un pis-aller acceptable : « moins précis, mais jamais
 * faux ».
 *
 * Le premier appel réel, le 28 août 2026, a montré ce que ça donne. Le
 * domaine global n'est pas une moyenne : c'est le MAXIMUM du territoire. Ce
 * jour-là il valait orange, à cause de Rapa seule — à mille cinq cents
 * kilomètres des Tuamotu, de l'autre côté du Pacifique sud. Un pêcheur de
 * Rangiroa ouvrait donc l'application par temps calme et lisait
 * « VIGILANCE ORANGE · vagues-submersion ».
 *
 * C'est exactement la faute que l'associé nous avait demandé d'éviter : une
 * alerte qui ne correspond pas à ce que les gens voient dehors. Elle ne se
 * paie pas une fois — après deux ou trois oranges pour rien, plus personne
 * ne regarde le bandeau, y compris le jour où il est juste. Une alerte
 * qu'on n'écoute plus ne protège personne.
 *
 * Le flux donne les trente zones une par une. On peut donc afficher le
 * niveau ET dire d'où il vient : « orange sur Rapa uniquement ». Le
 * pêcheur voit l'alerte, et voit qu'elle n'est pas chez lui. Rien n'est
 * caché, rien n'est exagéré.
 *
 * ⚠️  ON NE FAIT PAS DIRE AU SILENCE QUE ÇA NE NOUS CONCERNE PAS.
 *
 * Cette liste ne prouve pas que l'île est hors de danger : sa zone reste
 * inconnue, et elle est peut-être l'une de celles qui sont nommées. C'est
 * un élément de jugement rendu à l'utilisateur, pas un feu vert donné à sa
 * place. Le texte de l'écran doit rester dans ce registre.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * @returns [{ zoneId, zone, etat }] — les zones nommées au-dessus du vert,
 *          sans le domaine global, la plus grave d'abord.
 */
export function zonesEnAlerte(domaines) {
  if (!Array.isArray(domaines)) return [];

  const parNom = new Map();

  for (const d of domaines) {
    const id = d && d.domain_id ? String(d.domain_id) : null;
    if (!id || id === 'VIGI987') continue;      // le global n'explique rien

    const niveau = Number(d.max_color_id);
    if (!(niveau > 1)) continue;                // vert, ou illisible

    const etat = NIVEAUX[niveau];
    if (!etat) continue;

    // Les treize sous-zones des Îles du Vent (VIGI987-14-50 à -63) n'ont pas
    // de nom à elles dans la table. On les rattache à leur zone mère plutôt
    // que d'afficher un identifiant brut à quelqu'un qui décide s'il sort.
    const nom = nommerZone(id);
    const vu = parNom.get(nom);
    if (!vu || niveau > vu.niveau) parNom.set(nom, { zoneId: id, zone: nom, etat, niveau });
  }

  return [...parNom.values()]
    .sort((a, b) => b.niveau - a.niveau || a.zone.localeCompare(b.zone))
    .map(({ zoneId, zone, etat }) => ({ zoneId, zone, etat }));
}

/** Le nom d'une zone, ou celui de sa zone mère pour une sous-zone. */
function nommerZone(id) {
  const dans = (k) => Object.prototype.hasOwnProperty.call(ZONES, k);
  if (dans(id)) return ZONES[id];
  const mere = id.replace(/-\d+$/, '');
  if (mere !== id && dans(mere)) return ZONES[mere];
  return id;
}
