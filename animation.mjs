#!/usr/bin/env node
/**
 * Mata'i — les nuages qui bougent.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI UNE BOUCLE ET PAS UNE IMAGE
 *
 * Une image fixe dit où sont les nuages. Elle ne dit pas où ils VONT.
 * Or c'est exactement la question de celui qui décide s'il sort :
 * ce grain à l'ouest de Bora Bora, est-ce qu'il arrive sur moi, ou
 * est-ce qu'il file au sud ?
 *
 * Deux images à dix minutes d'écart répondent à ça. Douze images sur deux
 * heures donnent la direction, la vitesse, et si ça se creuse ou si ça se
 * délite. C'est la différence entre une photo et une prévision qu'on fait
 * soi-même avec ses yeux — ce que fait tout marin depuis toujours.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * GOES-18 publie une nouvelle image du disque terrestre toutes les DIX
 * minutes, aux minutes rondes 00, 10, 20… Chacune pèse une vingtaine de
 * mégaoctets et sort du four sept à douze minutes après l'heure de prise
 * de vue, le temps du balayage et du traitement.
 *
 * Ce script ne télécharge que les images qui manquent : au régime de
 * croisière, deux par passage. Il recadre sur la Polynésie, écrit une
 * vignette de trois cents kilo-octets, jette celles qui sont sorties de
 * la fenêtre, et republie l'index.
 *
 *   node animation.mjs           met la boucle à jour
 *   node animation.mjs --etat    dit seulement ce qu'il y a en réserve
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlDatee, telecharger, recadrerRegion } from './nuages.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, 'paquets');
const DOSSIER = join(SORTIE, 'nuages', 'anim');
const INDEX = join(DOSSIER, 'index.json');

/** Cadence du satellite. Ce n'est pas un réglage : c'est un fait. */
export const CADENCE = 10;

/**
 * Durée de la boucle. Deux heures, parce que c'est l'horizon utile :
 * en dessous on ne voit pas la tendance, au-dessus on fait payer des
 * mégaoctets pour une histoire ancienne.
 */
export const FENETRE_MIN = 120;

/**
 * Délai de publication. Une image datée de 14 h 00 n'existe pas à 14 h 05.
 * On ne va donc jamais la chercher avant ce délai — sinon on collectionne
 * les 404 et on ralentit le passage pour rien.
 */
const LATENCE_MIN = 15;

/**
 * Qualité JPEG des images de la boucle. Un cran en dessous de l'image
 * fixe : à douze exemplaires, chaque point de qualité se paie en forfait
 * mobile, et un nuage n'a pas de contour net à trahir.
 */
const QUALITE = 70;

/** Au-delà, on rend la main : le passage suivant finira le travail. */
const BUDGET_MS = 5 * 60 * 1000;

// ------------------------------------------------------------ horodatage

/** Quantième du jour, de 1 à 366. */
function quantieme(d) {
  const debut = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - debut) / 86400000) + 1;
}

const deuxChiffres = (n) => String(n).padStart(2, '0');

/** Une date JS vers l'écriture NOAA : AAAAJJJHHMM. */
export function versHorodatage(d) {
  return `${d.getUTCFullYear()}${String(quantieme(d)).padStart(3, '0')}` +
         `${deuxChiffres(d.getUTCHours())}${deuxChiffres(d.getUTCMinutes())}`;
}

/** Et le chemin inverse, pour pouvoir afficher une heure lisible. */
export function versDate(h) {
  const an = +h.slice(0, 4), jour = +h.slice(4, 7);
  const hh = +h.slice(7, 9), mm = +h.slice(9, 11);
  return new Date(Date.UTC(an, 0, jour, hh, mm));
}

/**
 * Les horodatages attendus dans la fenêtre, du plus ancien au plus récent.
 * On part de maintenant moins la latence, arrondi à la cadence inférieure.
 */
export function creneaux(maintenant = new Date()) {
  const ms = CADENCE * 60000;
  const fin = Math.floor((maintenant.getTime() - LATENCE_MIN * 60000) / ms) * ms;
  const n = Math.floor(FENETRE_MIN / CADENCE);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(versHorodatage(new Date(fin - i * ms)));
  return out;
}

// ------------------------------------------------------------------ état

async function lireIndex() {
  try {
    return JSON.parse(await readFile(INDEX, 'utf8'));
  } catch {
    return null;
  }
}

/** Ce qu'on a réellement sur le disque, quoi qu'en dise l'index. */
async function enReserve() {
  try {
    const noms = await readdir(DOSSIER);
    return new Set(noms.filter((n) => n.endsWith('.jpg')).map((n) => n.slice(0, -4)));
  } catch {
    return new Set();
  }
}

// ------------------------------------------------------------- fabrique

export async function produireAnimation(sortie = SORTIE) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.log('  animation : sharp absent, étape ignorée');
    return null;
  }

  const dossier = join(sortie, 'nuages', 'anim');
  await mkdir(dossier, { recursive: true });

  const attendus = creneaux();
  const presents = await enReserve();
  const manquants = attendus.filter((h) => !presents.has(h));

  console.log(`  animation : ${attendus.length} créneaux voulus, ${manquants.length} à chercher`);

  const debut = Date.now();
  let emprise = null;
  let obtenues = 0;

  // Du plus récent au plus ancien : si le budget saute, on aura au moins
  // les images qui comptent le plus.
  for (const h of [...manquants].reverse()) {
    if (Date.now() - debut > BUDGET_MS) {
      console.log('  animation : budget de temps atteint, la suite au prochain passage');
      break;
    }
    try {
      const entiere = await telecharger(urlDatee(h));
      const meta = await sharp(entiere).metadata();
      const { image, emprise: e } = await recadrerRegion(sharp, entiere, meta.width, QUALITE);
      await writeFile(join(dossier, `${h}.jpg`), image);
      emprise = { ...e, disque: meta.width };
      presents.add(h);
      obtenues++;
      console.log(`  animation : ${h} (${(image.length / 1024).toFixed(0)} Ko)`);
    } catch (e) {
      // Une image absente n'est pas une panne : le satellite saute parfois
      // un créneau pour une manœuvre ou un étalonnage.
      console.log(`  animation : ${h} indisponible — ${e.message}`);
    }
  }

  // On garde exactement la fenêtre, et on efface le reste.
  const gardees = attendus.filter((h) => presents.has(h));
  for (const h of presents) {
    if (gardees.includes(h)) continue;
    try { await unlink(join(dossier, `${h}.jpg`)); } catch {}
  }

  if (gardees.length === 0) {
    console.log('  animation : aucune image disponible, index inchangé');
    return null;
  }

  // L'emprise ne bouge jamais — le satellite est immobile. Si aucune image
  // n'a été téléchargée ce coup-ci, on reprend celle de l'index précédent.
  const ancien = await lireIndex();
  if (!emprise && ancien) {
    emprise = {
      gauche: ancien.origine.col, haut: ancien.origine.lig,
      largeur: ancien.largeur, hauteur: ancien.hauteur, disque: ancien.disque
    };
  }
  if (!emprise) {
    console.log('  animation : emprise inconnue, index non écrit');
    return null;
  }

  const index = {
    version: 1,
    cadence: CADENCE,
    fenetreMinutes: FENETRE_MIN,
    largeur: emprise.largeur,
    hauteur: emprise.hauteur,
    origine: { col: emprise.gauche, lig: emprise.haut },
    disque: emprise.disque,
    kilometresParPixel: 2,
    source: 'NOAA GOES-18 (GOES-West) — GEOCOLOR',
    genere: new Date().toISOString(),
    images: gardees.map((h) => ({
      fichier: `nuages/anim/${h}.jpg`,
      t: versDate(h).toISOString()
    }))
  };

  await writeFile(join(dossier, 'index.json'), JSON.stringify(index), 'utf8');

  const derniere = versDate(gardees[gardees.length - 1]);
  const age = Math.round((Date.now() - derniere.getTime()) / 60000);
  console.log(`  animation : ${gardees.length} images, ${obtenues} nouvelle(s), la plus fraîche a ${age} min`);

  return index;
}

// ─────────────────────────── ligne de commande ───────────────────────────

const APPEL_DIRECT = process.argv[1] && process.argv[1].endsWith('animation.mjs');

if (APPEL_DIRECT) {
  if (process.argv.includes('--etat')) {
    const index = await lireIndex();
    const presents = await enReserve();
    console.log(`Images sur le disque : ${presents.size}`);
    console.log(`Créneaux voulus      : ${creneaux().join(', ')}`);
    if (index) {
      console.log(`Index : ${index.images.length} images, généré ${index.genere}`);
      console.log(`Plus récente : ${index.images[index.images.length - 1].t}`);
    } else {
      console.log('Index : absent');
    }
  } else {
    await produireAnimation();
  }
}
