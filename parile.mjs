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

/** Une ligne de journal par île, lisible d'un coup d'œil. */
export function direMesures(mesures) {
  return mesures.map((m) => {
    if (m.refus) return `      ${(m.nom || m.id).padEnd(12)} refus : ${m.refus}`;
    return `      ${(m.nom || m.id).padEnd(12)} ${String(m.noeuds).padStart(2)} nds vers `
      + `${String(m.cap).padStart(3)}° · dispersion ${m.dispersion} · tuiles ${m.desaccord}`;
  });
}
