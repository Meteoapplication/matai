/**
 * Mata'i — les nuages en temps réel, vus du satellite.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI C'EST POSSIBLE ICI ET PRESQUE NULLE PART AILLEURS
 *
 * Le satellite GOES-18 est en orbite géostationnaire à 137° ouest. La
 * Polynésie française est autour de 150° ouest — soit treize degrés de son
 * point de visée directe. Vous êtes pratiquement dessous, avec un des
 * meilleurs angles de vue de la planète, et une image toutes les dix
 * minutes. Les données sont publiques et libres de droits (NOAA).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Le problème : la NOAA ne publie aucune découpe pour la Polynésie. Elle
 * publie un disque terrestre entier. En petite taille l'archipel fait
 * quarante pixels ; en grande taille, c'est plusieurs mégaoctets, ce qui
 * est impensable sur un téléphone aux Tuamotu.
 *
 * Ce fichier fait donc le travail que personne n'a fait : il télécharge le
 * disque complet une fois, découpe une fenêtre autour de chaque île, et
 * publie une vignette de quelques dizaines de kilo-octets.
 *
 *   node nuages.mjs --test      télécharge et découpe Bora Bora seulement,
 *                               écrit test-nuages.jpg, et n'écrit rien d'autre
 *
 * Lance cette commande AVANT de brancher quoi que ce soit : elle sert à
 * vérifier de tes yeux que l'île tombe bien au milieu de l'image.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));

/**
 * L'image source. GEOCOLOR est la composition qui ressemble à ce que
 * verrait l'œil de jour, et bascule en infrarouge la nuit — c'est la seule
 * qui reste lisible 24 h sur 24.
 *
 * 5424 pixels = résolution native de 2 km. C'est le minimum pour qu'une
 * fenêtre de quelques degrés autour d'une île reste exploitable.
 */
export const SOURCE =
  'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/FD/GEOCOLOR/5424x5424.jpg';

/** Largeur de la fenêtre découpée, en degrés. */
const FENETRE = 7;

/**
 * Géométrie du satellite, telle que définie par la NOAA pour la série
 * GOES-R. Ces constantes ne sont pas négociables : elles décrivent la
 * projection dans laquelle l'image est publiée.
 */
const GEO = {
  lon0: -137.0,          // point sous-satellite de GOES-West
  H: 42164160.0,         // distance du satellite au centre de la Terre (m)
  rEq: 6378137.0,        // rayon équatorial
  rPol: 6356752.31414,   // rayon polaire
  e2: 0.0066943799901413,
  // étendue angulaire du disque complet, en radians
  demiAngle: 0.151872
};

/**
 * Convertit une position terrestre en coordonnées de pixel sur le disque.
 * Renvoie null si le point n'est pas visible depuis le satellite.
 */
export function versPixel(lat, lon, taille) {
  const d = Math.PI / 180;
  const { lon0, H, rEq, rPol, e2, demiAngle } = GEO;

  const phi = lat * d;
  const dLon = (lon - lon0) * d;

  // latitude géocentrique : la Terre est un ellipsoïde, pas une sphère
  const phiC = Math.atan((rPol * rPol) / (rEq * rEq) * Math.tan(phi));
  const rc = rPol / Math.sqrt(1 - e2 * Math.cos(phiC) * Math.cos(phiC));

  const sx = H - rc * Math.cos(phiC) * Math.cos(dLon);
  const sy = -rc * Math.cos(phiC) * Math.sin(dLon);
  const sz = rc * Math.sin(phiC);

  // le point est-il de l'autre côté de la Terre ?
  if (H * (H - sx) < sy * sy + (rEq * rEq) / (rPol * rPol) * sz * sz) return null;

  const x = Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz)); // est-ouest
  const y = Math.atan(sz / sx);                                       // nord-sud

  // l'image couvre [-demiAngle, +demiAngle] sur ses deux axes
  const parPixel = (2 * demiAngle) / taille;
  return {
    col: (x + demiAngle) / parPixel,
    lig: (demiAngle - y) / parPixel,
    parPixel
  };
}

/** Taille en pixels d'une fenêtre de N degrés autour d'un point. */
export function tailleFenetre(lat, lon, taille, degres) {
  const a = versPixel(lat, lon - degres / 2, taille);
  const b = versPixel(lat, lon + degres / 2, taille);
  if (!a || !b) return null;
  return Math.round(Math.abs(b.col - a.col));
}

/**
 * L'emprise régionale : toute la Polynésie française d'un seul tenant.
 *
 * La vignette par île sert à l'écran Sortie — un coup d'œil, pas plus.
 * Celle-ci sert à explorer : on la publie à la résolution native du
 * satellite pour que l'utilisateur puisse se déplacer et zoomer jusqu'à
 * la limite physique de 2 km par pixel, et pas un centimètre de plus.
 *
 * Environ 1233 × 1067 pixels, soit 2464 km sur 2133 km. Elle n'est
 * téléchargée que quand on ouvre la carte, jamais au démarrage.
 */
const REGION = { lat: [-28.5, -7.5], lon: [-156.5, -133.5] };

export function empriseRegion(taille) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let la = REGION.lat[0]; la <= REGION.lat[1]; la += 0.5) {
    for (let lo = REGION.lon[0]; lo <= REGION.lon[1]; lo += 0.5) {
      const p = versPixel(la, lo, taille);
      if (!p) continue;
      if (p.col < x0) x0 = p.col;
      if (p.col > x1) x1 = p.col;
      if (p.lig < y0) y0 = p.lig;
      if (p.lig > y1) y1 = p.lig;
    }
  }
  const gauche = Math.max(0, Math.floor(x0));
  const haut = Math.max(0, Math.floor(y0));
  return {
    gauche,
    haut,
    largeur: Math.min(Math.ceil(x1) - gauche, taille - gauche),
    hauteur: Math.min(Math.ceil(y1) - haut, taille - haut)
  };
}

async function telecharger(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Découpe une fenêtre autour d'un point et renvoie un JPEG réduit.
 * `sharp` est utilisé parce qu'il découpe sans décompresser toute l'image
 * en mémoire — sur 29 millions de pixels, ça compte.
 */
export async function decouper(sharp, imageEntiere, lat, lon, taille, cote = 520) {
  const p = versPixel(lat, lon, taille);
  if (!p) throw new Error(`${lat}/${lon} n'est pas visible depuis GOES-18`);

  const larg = tailleFenetre(lat, lon, taille, FENETRE);
  if (!larg || larg < 20) throw new Error('fenêtre calculée aberrante');

  const gauche = Math.max(0, Math.round(p.col - larg / 2));
  const haut = Math.max(0, Math.round(p.lig - larg / 2));
  const l = Math.min(larg, taille - gauche);
  const h = Math.min(larg, taille - haut);

  return sharp(imageEntiere)
    .extract({ left: gauche, top: haut, width: l, height: h })
    .resize(cote, cote, { fit: 'fill' })
    .jpeg({ quality: 78, progressive: true })
    .toBuffer();
}

/**
 * Découpe l'emprise régionale et l'écrit. Renvoie de quoi replacer
 * n'importe quel point du globe dans l'image côté application : sans
 * l'origine et la taille du disque, les repères seraient décoratifs.
 */
export async function decouperRegion(sharp, entiere, taille, sortie, horodatage) {
  const e = empriseRegion(taille);
  const image = await sharp(entiere)
    .extract({ left: e.gauche, top: e.haut, width: e.largeur, height: e.hauteur })
    .jpeg({ quality: 76, progressive: true })
    .toBuffer();

  await writeFile(join(sortie, 'nuages', 'polynesie.jpg'), image);

  return {
    fichier: 'nuages/polynesie.jpg',
    horodatage,
    largeur: e.largeur,
    hauteur: e.hauteur,
    origine: { col: e.gauche, lig: e.haut },
    disque: taille,
    kilometresParPixel: 2,
    source: 'NOAA GOES-18 (GOES-West) — GEOCOLOR',
    poids: image.length
  };
}

/**
 * Produit une vignette par île. Renvoie un objet { ileId: infos } que
 * build.mjs joint aux paquets.
 *
 * Toute panne renvoie un objet vide : les nuages sont un plus, jamais une
 * raison de faire échouer la publication des prévisions.
 */
export async function produire(iles, sortie) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (e) {
    console.log('  nuages : sharp absent, étape ignorée');
    return { iles: {}, region: null };
  }

  let entiere;
  try {
    entiere = await telecharger(SOURCE);
    console.log(`  nuages : disque complet reçu (${(entiere.length / 1048576).toFixed(1)} Mo)`);
  } catch (e) {
    console.log(`  nuages : téléchargement impossible — ${e.message}`);
    return { iles: {}, region: null };
  }

  const meta = await sharp(entiere).metadata();
  const taille = meta.width;
  const horodatage = new Date().toISOString();
  const resultat = { iles: {}, region: null };

  await mkdir(join(sortie, 'nuages'), { recursive: true });

  try {
    resultat.region = await decouperRegion(sharp, entiere, taille, sortie, horodatage);
    const r = resultat.region;
    console.log(`  nuages : région entière ${r.largeur}×${r.hauteur} (${(r.poids / 1024).toFixed(0)} Ko)`);
  } catch (e) {
    console.log(`  nuages : région entière échouée — ${e.message}`);
  }

  for (const ile of iles) {
    const n = ile.spots.length || 1;
    const lat = ile.spots.reduce((s, x) => s + x.lat, 0) / n;
    const lon = ile.spots.reduce((s, x) => s + x.lon, 0) / n;
    try {
      const vignette = await decouper(sharp, entiere, lat, lon, taille);
      await writeFile(join(sortie, 'nuages', `${ile.id}.jpg`), vignette);
      resultat.iles[ile.id] = {
        fichier: `nuages/${ile.id}.jpg`,
        horodatage,
        fenetre: FENETRE,
        source: 'NOAA GOES-18 (GOES-West) — GEOCOLOR'
      };
      console.log(`  nuages : ${ile.nom} (${(vignette.length / 1024).toFixed(0)} Ko)`);
    } catch (e) {
      console.log(`  nuages : ${ile.nom} échoué — ${e.message}`);
    }
  }

  return resultat;
}

// ─────────────────────────── mode test ───────────────────────────

if (process.argv.includes('--test')) {
  const sharp = (await import('sharp')).default;
  console.log('Téléchargement du disque complet GOES-18…');
  const entiere = await telecharger(SOURCE);
  const meta = await sharp(entiere).metadata();
  console.log(`Image reçue : ${meta.width}×${meta.height}, ${(entiere.length / 1048576).toFixed(1)} Mo`);

  const lat = -16.5, lon = -151.77;
  const p = versPixel(lat, lon, meta.width);
  console.log(`Bora Bora tombe au pixel ${Math.round(p.col)}, ${Math.round(p.lig)}`);
  console.log(`Fenêtre de ${FENETRE}° = ${tailleFenetre(lat, lon, meta.width, FENETRE)} pixels`);

  const vignette = await decouper(sharp, entiere, lat, lon, meta.width);
  await writeFile(join(ICI, 'test-nuages.jpg'), vignette);
  console.log(`\nÉcrit : test-nuages.jpg (${(vignette.length / 1024).toFixed(0)} Ko)`);
  console.log('Ouvre-le. Bora Bora doit être au centre — un petit point de terre');
  console.log('entouré de lagon clair. Si l’île est décalée, dis-moi de combien.');
}
