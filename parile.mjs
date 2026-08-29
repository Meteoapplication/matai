/**
 * Mata'i — LE MOUVEMENT DES NUAGES, ÎLE PAR ÎLE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE : LE MODÈLE RÉGIONAL EST FAUX.
 *
 * `projection.mjs` mesure UN déplacement pour toute la Polynésie et
 * translate l'image entière. L'emprise fait 2 464 km sur 2 133 — Paris à
 * Moscou. Mesuré le 28 août 2026 sur les images infrarouges réelles, en
 * découpant la région en seize tuiles, sur une même paire de quarante
 * minutes :
 *
 *     (-1,1)   (-2,3)   (0,4)   (-1,4)
 *     (2,0)    (0,0)    (3,3)   (-2,1)
 *     (0,0)    (0,0)    (0,0)   (0,0)
 *     (-1,-3)  (3,-2)   (2,-1)  (4,1)
 *
 * À 6 km le pixel : trente-six kilomètres de désaccord entre les coins. Le
 * nord-est descend, le sud-ouest monte, le centre ne bouge pas. Aucune
 * translation unique ne décrit ce ciel, et ce n'est pas une surprise : la
 * région traverse la zone de convergence, la ceinture des alizés et vingt
 * et un degrés de latitude.
 *
 * ⚠️  LA MÊME MÉTHODE, À LA BONNE ÉCHELLE, MARCHE.
 *
 * Sur une fenêtre de mille kilomètres autour de Bora Bora, quatre paires
 * successives de quarante minutes se sont accordées :
 *
 *     02:10→02:50   global (0,0)   tuiles (1,-1) (0,0) (3,1) (0,0)
 *     02:50→03:30   global (0,0)   tuiles (1,0)  (0,0) (1,0) (0,0)
 *     03:30→04:10   global (0,0)   tuiles (1,0)  (0,1) (1,0) (0,0)
 *     04:10→04:50   global (0,0)   tuiles (1,0)  (0,1) (2,0) (0,0)
 *
 * Et c'est aussi la seule question qui intéresse quelqu'un : « ce grain,
 * il arrive sur moi ? » — pas « que fait le ciel de Rapa ».
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  CE MODULE NE PUBLIE RIEN. C'EST VOLONTAIRE, ET C'EST TEMPORAIRE.
 *
 * Il mesure, et `build.mjs` écrit le résultat dans le journal. Rien n'est
 * servi à l'application. Raison : on a déjà, dans ce projet, publié une
 * fonctionnalité dont les chiffres n'avaient jamais été regardés en
 * production — la projection régionale, jamais sortie une seule fois, dont
 * personne ne s'est aperçu pendant tout son développement parce que
 * l'erreur était rattrapée et le passage restait vert.
 *
 * On inverse l'ordre : d'abord les chiffres réels, ensuite la publication.
 * Quelques passages suffiront à savoir si les îles s'accordent vraiment, et
 * lesquelles. Brancher la publication demandera alors une dizaine de lignes
 * dans `projection.mjs` — et on saura ce qu'on publie.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { decalage, normaliser, ecartEclairement, desaccordSpatial,
         decalageParTuiles } from './projection.mjs';

/** Côté de la grille de corrélation, par fenêtre d'île. */
const GRILLE = 256;

/**
 * Rayon de la fenêtre autour de l'île, en kilomètres.
 *
 * Mille kilomètres de côté : c'est l'échelle où les tuiles se sont
 * accordées. Plus petit, il n'y a plus assez de nuages pour corréler ; plus
 * grand, on retombe dans le désaccord régional.
 */
export const RAYON_KM = 500;

/** Combien de pas séparent les deux images d'une paire. Comme en régional. */
const ECART = 4;

/** Combien de paires on mesure. */
const PAIRES = 4;

/** Désaccord maximal toléré entre les tuiles d'une fenêtre, en px de grille. */
const DESACCORD_MAX = 4;

/** Variation de luminance au-delà de laquelle on ne conclut pas. */
const ECLAIREMENT_MAX = 0.15;

/** Médiane d'une liste de nombres. */
function mediane(l) {
  const t = [...l].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

/**
 * La fenêtre à découper autour d'une île, en pixels de l'image recadrée.
 *
 * @param largeur,hauteur  dimensions de l'image recadrée
 * @param x,y              position de l'île, en fractions de 0 à 1
 * @param kmParPixel       échelle de l'image recadrée
 *
 * ⚠️  La fenêtre est RAMENÉE dans le cadre quand l'île est près du bord,
 * jamais rétrécie. Une fenêtre plus petite mesurerait sur moins de nuages
 * et rendrait un chiffre moins sûr sans le dire — alors qu'une fenêtre
 * décentrée mesure le même vent, simplement pas exactement au-dessus de
 * l'île. Aux Marquises et aux Gambier, qui sont dans les coins de
 * l'emprise, c'est la différence entre une mesure et rien.
 */
export function fenetreIle(largeur, hauteur, x, y, kmParPixel, rayonKm = RAYON_KM) {
  const cote = Math.round((2 * rayonKm) / kmParPixel);
  const c = Math.min(cote, largeur, hauteur);
  let gauche = Math.round(x * largeur - c / 2);
  let haut = Math.round(y * hauteur - c / 2);
  gauche = Math.max(0, Math.min(gauche, largeur - c));
  haut = Math.max(0, Math.min(haut, hauteur - c));
  return { gauche, haut, cote: c };
}

/** Lit une fenêtre d'image et la rend en niveaux de gris sur GRILLE × GRILLE. */
async function fenetreEnGris(sharp, chemin, f) {
  return sharp(chemin)
    .extract({ left: f.gauche, top: f.haut, width: f.cote, height: f.cote })
    .resize(GRILLE, GRILLE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
}

/**
 * Mesure le mouvement dans la fenêtre d'une île.
 *
 * @returns { dx, dy, kmh, cap, dispersion, desaccord } en pixels de grille
 *          par pas — ou { refus } si on ne conclut pas.
 */
export async function mesurerUneIle(sharp, chemins, f, kmParPixel, cadenceMin = 10) {
  if (!chemins || chemins.length < ECART + 2) return { refus: 'pas assez d’images' };

  const n = chemins.length;
  const paires = [];
  for (let i = n - 1; i - ECART >= 0 && paires.length < PAIRES; i--) {
    paires.push([chemins[i - ECART], chemins[i]]);
  }
  if (paires.length < 2) return { refus: 'pas assez de paires' };

  const cache = new Map();
  const gris = async (c) => {
    if (!cache.has(c)) cache.set(c, await fenetreEnGris(sharp, c, f));
    return cache.get(c);
  };

  const dxs = [], dys = [];
  let pireEclairement = 0;
  let tuiles = null;

  for (const [avant, apres] of paires) {
    const ga = await gris(avant), gb = await gris(apres);
    const e = ecartEclairement(ga, gb);
    if (e > pireEclairement) pireEclairement = e;

    const gbn = normaliser(ga, gb);
    // ±12 px de grille sur la base de 40 min. À 3,9 km le pixel de grille,
    // cela plafonne à 47 km en quarante minutes, soit 70 km/h.
    const d = decalage(ga, gbn, GRILLE, 12);
    dxs.push(d.dx);
    dys.push(d.dy);
    if (tuiles === null) tuiles = decalageParTuiles(ga, gbn, GRILLE, 2, 6);
  }

  if (pireEclairement > ECLAIREMENT_MAX) {
    return { refus: 'éclairement en train de changer',
             eclairement: Math.round(pireEclairement * 100) / 100 };
  }

  const dxBase = mediane(dxs), dyBase = mediane(dys);
  const dispersion = Math.max(
    Math.max(...dxs) - Math.min(...dxs),
    Math.max(...dys) - Math.min(...dys));
  const desaccord = desaccordSpatial(tuiles);

  if (dispersion > 6) return { refus: 'mouvement incohérent dans le temps', dispersion, dxs, dys };
  if (desaccord > DESACCORD_MAX) return { refus: 'ciel non uniforme dans la fenêtre', desaccord, dispersion };
  if (dxBase === 0 && dyBase === 0 && dispersion === 0) {
    return { refus: 'déplacement nul', dispersion };
  }

  // Retour en unités physiques. Le pixel de grille vaut la fenêtre divisée
  // par GRILLE ; la base couvre ECART pas de `cadenceMin` minutes.
  const kmParGrille = (f.cote * kmParPixel) / GRILLE;
  const minutes = ECART * cadenceMin;
  const kmh = Math.hypot(dxBase, dyBase) * kmParGrille * (60 / minutes);

  // Le cap VERS lequel ça va, en degrés depuis le nord. y croît vers le bas.
  const cap = (Math.atan2(dxBase, -dyBase) * 180 / Math.PI + 360) % 360;

  return {
    dx: dxBase / ECART, dy: dyBase / ECART,
    dxBase, dyBase, dispersion, desaccord,
    kmh: Math.round(kmh),
    noeuds: Math.round(kmh / 1.852),
    cap: Math.round(cap),
    kmParGrille: Math.round(kmParGrille * 10) / 10
  };
}

/**
 * Mesure toutes les îles d'un coup.
 *
 * @param iles  [{ id, nom, x, y }] — x et y en fractions de l'image recadrée
 */
export async function mesurerToutesLesIles(sharp, chemins, iles, geo) {
  const { largeur, hauteur, kmParPixel = 2, cadence = 10 } = geo;
  const out = [];
  for (const ile of iles) {
    if (typeof ile.x !== 'number' || typeof ile.y !== 'number') {
      out.push({ id: ile.id, nom: ile.nom, refus: 'position inconnue dans l’emprise' });
      continue;
    }
    const f = fenetreIle(largeur, hauteur, ile.x, ile.y, kmParPixel);
    let r;
    try {
      r = await mesurerUneIle(sharp, chemins, f, kmParPixel, cadence);
    } catch (e) {
      r = { refus: 'erreur — ' + e.message };
    }
    out.push({ id: ile.id, nom: ile.nom, fenetreKm: Math.round(f.cote * kmParPixel), ...r });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
 * QUAND A-T-ON LE DROIT DE MONTRER UNE FLÈCHE ?
 *
 * Une mesure isolée ne prouve rien. La corrélation rend TOUJOURS un
 * déplacement — c'est le maximum d'une surface, il existe même dans du
 * bruit. Les garde-fous de `mesurerUneIle` écartent les cas manifestement
 * faux, mais un ciel qui se transforme peut passer une fois par accident.
 *
 * Ce qu'on ne peut pas simuler et qu'un accident ne reproduit pas, c'est la
 * PERSISTANCE : un alizé établi donne la même direction, passage après
 * passage, pendant des heures. Un artefact non.
 *
 * La règle ci-dessous ne demande donc pas « la dernière mesure est-elle
 * bonne » mais « cette île bouge-t-elle dans le même sens depuis deux
 * heures ». C'est le seul juge qu'on ait qui ne soit pas une opinion — et
 * c'est lui qui décide de publier, pas un humain qui aurait regardé des
 * journaux et trouvé que « ça a l'air bon ».
 * ═══════════════════════════════════════════════════════════════════════ */

/** Combien de passages récents du carnet on regarde. */
export const FENETRE_PASSAGES = 6;

/** Combien d'entre eux doivent avoir donné une mesure. */
export const ACCORDS_MIN = 3;

/**
 * Écart de cap toléré entre ces mesures, en degrés.
 *
 * Un alizé établi tourne de dix à vingt degrés sur deux heures. Quarante-cinq
 * laisse la marge d'une brise qui vire sans laisser passer deux directions
 * qui n'ont rien à voir.
 */
export const ETENDUE_CAP_MAX = 45;

/** Étendue de vitesse tolérée : la plus grande de 6 nœuds ou de la moitié. */
function vitesseCoherente(noeuds) {
  const min = Math.min(...noeuds), max = Math.max(...noeuds);
  const med = mediane(noeuds);
  return (max - min) <= Math.max(6, med * 0.5);
}

/**
 * Moyenne circulaire d'une liste de caps, et le plus grand écart à cette
 * moyenne. On passe par les vecteurs : la moyenne arithmétique de 350° et
 * 10° vaut 180°, ce qui désignerait le sud pour deux mesures qui pointent
 * toutes deux vers le nord.
 */
export function dispersionDesCaps(caps) {
  let x = 0, y = 0;
  for (const c of caps) {
    x += Math.cos(c * Math.PI / 180);
    y += Math.sin(c * Math.PI / 180);
  }
  const moyen = (Math.atan2(y / caps.length, x / caps.length) * 180 / Math.PI + 360) % 360;
  let etendue = 0;
  for (const c of caps) {
    let d = Math.abs(c - moyen) % 360;
    if (d > 180) d = 360 - d;
    if (d > etendue) etendue = d;
  }
  return { moyen: Math.round(moyen), etendue: Math.round(etendue) };
}

/**
 * Les îles dont le carnet autorise une publication, et pourquoi les autres
 * ne l'autorisent pas.
 *
 * ⚠️  LA MESURE LA PLUS RÉCENTE DOIT EN FAIRE PARTIE.
 *
 * Sans cette condition, une île qui a bien bougé pendant deux heures puis
 * s'est mise à refuser continuerait d'afficher sa dernière flèche connue —
 * une projection d'il y a une heure présentée comme celle de maintenant.
 * C'est précisément le mensonge que tout le reste du projet passe son temps
 * à empêcher, et il serait invisible : la flèche aurait l'air normale.
 *
 * @param passages  les entrées du carnet, de la plus ancienne à la plus récente
 */
export function ilesPubliables(passages) {
  const recents = (passages || []).slice(-FENETRE_PASSAGES);
  if (!recents.length) return { publiables: [], ecartes: [], passagesVus: 0 };

  const dernier = recents[recents.length - 1];
  const ids = new Set();
  for (const p of recents) for (const i of (p.iles || [])) ids.add(i.id);

  const publiables = [], ecartes = [];

  for (const id of ids) {
    const vues = recents
      .map((p) => (p.iles || []).find((i) => i.id === id))
      .filter((i) => i && !i.refus && typeof i.cap === 'number');

    const dansLeDernier = (dernier.iles || [])
      .find((i) => i.id === id && !i.refus && typeof i.cap === 'number');

    if (!dansLeDernier) {
      const r = (dernier.iles || []).find((i) => i.id === id);
      ecartes.push({ id, raison: 'pas de mesure au dernier passage'
        + (r && r.refus ? ' — ' + r.refus : '') });
      continue;
    }
    if (vues.length < ACCORDS_MIN) {
      ecartes.push({ id, raison: `seulement ${vues.length} mesure(s) sur les `
        + `${recents.length} derniers passages (il en faut ${ACCORDS_MIN})` });
      continue;
    }

    const { moyen, etendue } = dispersionDesCaps(vues.map((v) => v.cap));
    if (etendue > ETENDUE_CAP_MAX) {
      ecartes.push({ id, raison: `direction instable : ${etendue}° d’écart entre `
        + `les mesures (limite ${ETENDUE_CAP_MAX}°)` });
      continue;
    }
    const noeuds = vues.map((v) => v.noeuds);
    if (!vitesseCoherente(noeuds)) {
      ecartes.push({ id, raison: `vitesse instable : de ${Math.min(...noeuds)} à `
        + `${Math.max(...noeuds)} nœuds` });
      continue;
    }

    publiables.push({
      id,
      // On publie la mesure LA PLUS RÉCENTE, pas la moyenne : c'est celle
      // qui décrit le ciel de maintenant. La moyenne ne sert qu'à établir
      // que cette mesure-là s'inscrit dans une tendance.
      noeuds: dernier.iles.find((i) => i.id === id).noeuds,
      cap: dansLeDernier.cap,
      confiance: {
        passages: recents.length, mesures: vues.length,
        capMoyen: moyen, etendueCap: etendue
      }
    });
  }

  return { publiables, ecartes, passagesVus: recents.length };
}

/**
 * Le fichier servi à l'application, tel quel.
 *
 * ⚠️  `nature: 'projection'` N'EST PAS DÉCORATIF. L'application refuse tout
 * fichier qui ne se déclare pas ainsi. Le jour où une erreur de chemin
 * servirait ici de l'observation, elle serait affichée sous une étiquette
 * « projection » — ou l'inverse, ce qui est pire. Le point 8 du cahier des
 * charges interdit les deux, et un champ vérifié des deux côtés est le seul
 * garde-fou qui survive à une faute de frappe.
 */
export function fabriquerProjectionIles(passages, nomsParId = {}, maintenant = new Date()) {
  const r = ilesPubliables(passages);
  const nommer = (x) => ({ ...x, nom: nomsParId[x.id] || x.id });
  return {
    version: 1,
    genere: maintenant.toISOString(),
    nature: 'projection',
    fenetrePassages: r.passagesVus,
    iles: r.publiables.map(nommer),
    ecartees: r.ecartes.map(nommer)
  };
}

/** Une ligne de journal par île, lisible d'un coup d'œil. */
export function direMesures(mesures) {
  return mesures.map((m) => {
    if (m.refus) return `      ${(m.nom || m.id).padEnd(12)} refus : ${m.refus}`;
    return `      ${(m.nom || m.id).padEnd(12)} ${String(m.noeuds).padStart(2)} nds vers `
      + `${String(m.cap).padStart(3)}° · dispersion ${m.dispersion} · tuiles ${m.desaccord}`;
  });
}
