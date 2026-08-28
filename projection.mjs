/**
 * Mata'i — LA PROJECTION DU DÉPLACEMENT DES NUAGES.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CE FICHIER FABRIQUE DES IMAGES QUI N'EXISTENT PAS.
 *
 * Il regarde les dernières images satellite RÉELLES, mesure de combien la
 * couverture nuageuse s'est déplacée entre elles, et prolonge ce mouvement
 * d'une heure. Le résultat ressemble à une image satellite. Ce n'en est
 * pas une. Personne n'a photographié ce ciel-là.
 *
 * C'est utile — voir arriver une bande de grains une heure à l'avance
 * change une décision de sortie — et c'est dangereux pour exactement la
 * même raison. Les précautions ci-dessous ne sont pas décoratives.
 *
 * ⚠️  PRÉCAUTION 1 : LES FICHIERS NE SE MÉLANGENT JAMAIS.
 *
 * Les images observées vivent dans `nuages/anim/`. Les projections vivent
 * dans `nuages/projection/`, avec leur propre index. Aucun code ne verse
 * les unes dans la liste des autres. Un mélange par inadvertance ne serait
 * pas un défaut d'affichage : ce serait une image inventée présentée comme
 * une observation.
 *
 * ⚠️  PRÉCAUTION 2 : LA MENTION EST CUITE DANS LE PIXEL.
 *
 * Chaque image projetée porte un bandeau « PROJECTION » incrusté. Pas un
 * calque dessiné par l'application — un bandeau dans le JPEG. Parce qu'une
 * copie d'écran envoyée sur WhatsApp perd le calque et garde l'image, et
 * qu'à ce moment-là plus personne ne sait ce qu'il regarde.
 *
 * ⚠️  PRÉCAUTION 3 : UNE HEURE, PAS DAVANTAGE.
 *
 * On translate une image. Les nuages, eux, naissent, grossissent et
 * crèvent. Au-delà d'une heure la translation devient une fiction : les
 * cellules convectives polynésiennes se forment et se dissipent en moins
 * de deux heures. Six pas de dix minutes, et on s'arrête.
 *
 * ⚠️  PRÉCAUTION 4 : ON REFUSE DE PROJETER QUAND ON N'EST PAS SÛR.
 *
 * Si les images manquent, si le mouvement mesuré est incohérent d'une
 * paire à l'autre, ou s'il est aberrant (plus vite qu'un jet-stream), on
 * ne publie RIEN. Une projection absente est lisible ; une projection
 * fausse ne l'est pas.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * COMMENT LE MOUVEMENT EST MESURÉ
 *
 * Pas de réseau de neurones, pas de modèle : de la corrélation d'images.
 * On réduit chaque image en niveaux de gris (128 × 128), et pour chaque
 * paire consécutive on cherche le décalage entier (dx, dy) qui minimise la
 * somme des différences absolues sur la partie commune. C'est la méthode
 * la plus ancienne du traitement d'image, elle tient en cinquante lignes,
 * elle est déterministe, et sur des masses nuageuses qui défilent sous
 * l'alizé elle fait exactement le travail.
 *
 * On prend ensuite la MÉDIANE des décalages, pas la moyenne : une image
 * abîmée ou un morceau de nuit qui entre dans le cadre produit une paire
 * aberrante, et une moyenne la suivrait.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CADENCE, versDate, versHorodatage } from './animation.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, 'paquets');

/** Combien de pas de dix minutes on projette. Six = une heure. */
export const PAS = 6;

/** Combien de paires d'images servent à mesurer le mouvement. */
const PAIRES = 4;

/** Côté de l'image réduite servant à la corrélation. */
const GRILLE = 128;

/** Décalage maximal cherché, en pixels de la grille réduite. */
const RECHERCHE = 16;

/**
 * Vitesse au-delà de laquelle on considère la mesure aberrante.
 *
 * L'emprise régionale fait ~2 460 km de large. Sur une grille de 128, un
 * pixel vaut ~19 km. En dix minutes, 8 pixels = 154 km, soit 920 km/h :
 * au-delà, ce n'est plus un nuage, c'est un défaut de mesure.
 */
const DECALAGE_MAX = 8;

/**
 * Écart maximal toléré entre les paires, en pixels réduits. Au-delà, le
 * mouvement n'est pas cohérent et on ne projette pas.
 */
const DISPERSION_MAX = 4;

/** Médiane d'une liste de nombres. */
function mediane(l) {
  const t = [...l].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

/**
 * Le décalage (dx, dy) qui superpose le mieux `b` sur `a`.
 *
 * Les deux images sont des tableaux de GRILLE × GRILLE octets. On ne
 * compare que la zone commune, et on divise par le nombre de pixels
 * comparés — sans ça, les grands décalages gagneraient toujours, puisque
 * moins de pixels se chevauchent et que la somme est plus petite.
 */
export function decalage(a, b, taille = GRILLE, recherche = RECHERCHE) {
  let meilleur = { dx: 0, dy: 0, cout: Infinity };

  for (let dy = -recherche; dy <= recherche; dy++) {
    for (let dx = -recherche; dx <= recherche; dx++) {
      let somme = 0, n = 0;

      // Sous-échantillonnage d'un pixel sur deux : quatre fois moins de
      // travail pour un résultat identique à l'entier près, et ça compte
      // quand la boucle tourne 33 × 33 fois.
      for (let y = Math.max(0, -dy); y < Math.min(taille, taille - dy); y += 2) {
        const ligneA = y * taille;
        const ligneB = (y + dy) * taille;
        for (let x = Math.max(0, -dx); x < Math.min(taille, taille - dx); x += 2) {
          somme += Math.abs(a[ligneA + x] - b[ligneB + x + dx]);
          n++;
        }
      }
      if (n < taille * taille / 8) continue;   // trop peu de recouvrement

      const cout = somme / n;
      if (cout < meilleur.cout) meilleur = { dx, dy, cout };
    }
  }
  return meilleur;
}

/** Lit une image et la réduit en niveaux de gris bruts. */
async function enGris(sharp, chemin, taille = GRILLE) {
  const buf = await sharp(chemin)
    .resize(taille, taille, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  return buf;
}

/**
 * L'index de la boucle observée.
 *
 * ⚠️  Il prend son dossier en paramètre et n'utilise PAS la constante du
 * module. Premier jet : il lisait `SOURCE`, figé au dossier réel des
 * paquets. `produireProjection(dossier)` acceptait donc un dossier qu'elle
 * n'utilisait qu'à moitié — et le premier essai sur des images fabriquées
 * a répondu « pas assez d'images observées » alors qu'il y en avait douze
 * sous la main. Une fonction qu'un test ne peut pas atteindre ne prouve
 * rien de ce qu'on croit avoir vérifié.
 */
async function lireIndexAnim(dossier) {
  try {
    return JSON.parse(await readFile(join(dossier, 'index.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Mesure le mouvement des nuages sur les dernières images.
 *
 * @returns { dx, dy, dispersion, pixelsParPas, images } en pixels réduits
 *          par pas de CADENCE minutes — ou null si on refuse de conclure.
 */
export async function mesurerMouvement(sharp, fichiers) {
  if (!fichiers || fichiers.length < 3) return null;

  // Les plus récentes d'abord : le mouvement d'il y a deux heures n'a pas
  // à peser sur une projection de l'heure qui vient.
  const derniers = fichiers.slice(-(PAIRES + 1));
  const gris = [];
  for (const f of derniers) gris.push(await enGris(sharp, f));

  const dxs = [], dys = [];
  for (let i = 1; i < gris.length; i++) {
    const d = decalage(gris[i - 1], gris[i]);
    dxs.push(d.dx);
    dys.push(d.dy);
  }

  const dx = mediane(dxs);
  const dy = mediane(dys);

  // ⚠️  Deux refus, et ils comptent autant que le calcul lui-même.
  const dispersion = Math.max(
    Math.max(...dxs) - Math.min(...dxs),
    Math.max(...dys) - Math.min(...dys)
  );
  if (dispersion > DISPERSION_MAX) {
    return { refus: 'mouvement incohérent d’une image à l’autre', dispersion, dxs, dys };
  }
  if (Math.abs(dx) > DECALAGE_MAX || Math.abs(dy) > DECALAGE_MAX) {
    return { refus: 'déplacement aberrant', dx, dy };
  }

  return { dx, dy, dispersion, dxs, dys, images: derniers.length };
}

/**
 * Le bandeau incrusté. Volontairement laid et volontairement gros : ce
 * n'est pas une décoration, c'est un avertissement.
 */
function bandeau(largeur, hauteur, minutes) {
  const h = Math.max(26, Math.round(hauteur * 0.055));
  const texte = `PROJECTION · +${minutes} min · image calculée, non observée`;

  // ⚠️  LA POLICE SE CALCULE POUR TENIR, ELLE N'EST PAS CHOISIE.
  //
  // Premier jet : une taille fixée sur la hauteur du bandeau. Sur une image
  // de 400 pixels de large, l'avertissement se terminait par « non obs… » —
  // coupé net. Un avertissement tronqué est pire qu'absent : il a l'air
  // d'avoir été lu.
  //
  // 0,62 est la largeur moyenne d'un caractère GRAS en fraction de sa
  // hauteur pour une sans-serif ; on garde 14 pixels de marge de chaque
  // côté. Mesuré en rendant l'image : à 0,55 le dernier « e » de
  // « observée » sautait encore.
  const large = (largeur - 28) / (texte.length * 0.62);
  const police = Math.max(9, Math.min(Math.round(h * 0.52), Math.floor(large)));

  return Buffer.from(
    `<svg width="${largeur}" height="${hauteur}">
       <rect x="0" y="0" width="${largeur}" height="${h}" fill="#C0561B" opacity="0.92"/>
       <text x="12" y="${Math.round(h * 0.7)}" font-family="sans-serif"
             font-size="${police}" font-weight="bold" fill="#FFFFFF">${texte}</text>
     </svg>`
  );
}

/**
 * Produit les images projetées.
 *
 * @param sortie dossier des paquets
 */
export async function produireProjection(sortie = SORTIE) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (e) {
    return { erreur: 'sharp absent', images: [] };
  }

  const dossierSource = join(sortie, 'nuages', 'anim');
  const dossierCible = join(sortie, 'nuages', 'projection');

  const index = await lireIndexAnim(dossierSource);
  if (!index || !Array.isArray(index.images) || index.images.length < 3) {
    return { erreur: 'pas assez d’images observées', images: [] };
  }

  // Les noms de fichiers, dans l'ordre chronologique.
  const noms = index.images
    .map((x) => (typeof x === 'string' ? x : x.fichier || x.horodatage))
    .filter(Boolean)
    .map((n) => (n.endsWith('.jpg') ? n : n + '.jpg'))
    .sort();

  const chemins = noms.map((n) => join(dossierSource, n));

  const mouvement = await mesurerMouvement(sharp, chemins);
  if (!mouvement || mouvement.refus) {
    // ⚠️  On efface la projection précédente. Une projection périmée qui
    // survit à un refus est pire que pas de projection du tout : elle
    // continue d'être affichée comme si elle valait pour maintenant.
    await effacer(dossierCible);
    return {
      erreur: (mouvement && mouvement.refus) || 'mouvement non mesurable',
      detail: mouvement || null,
      images: []
    };
  }

  const derniere = chemins[chemins.length - 1];
  const meta = await sharp(derniere).metadata();
  const L = meta.width, H = meta.height;

  // Le décalage mesuré est en pixels de la grille réduite : on le ramène
  // à l'échelle de l'image réelle.
  const kx = L / GRILLE, ky = H / GRILLE;

  await mkdir(dossierCible, { recursive: true });
  await effacer(dossierCible);

  const base = versDate(noms[noms.length - 1].replace('.jpg', ''));
  const produites = [];

  for (let k = 1; k <= PAS; k++) {
    const dx = Math.round(mouvement.dx * kx * k);
    const dy = Math.round(mouvement.dy * ky * k);
    const minutes = k * CADENCE;
    const quand = new Date(base.getTime() + minutes * 60000);
    const nom = versHorodatage(quand) + '.jpg';

    // On décale l'image en l'étendant par le bord : les pixels qui entrent
    // dans le cadre n'existent pas, et prolonger le bord est le mensonge
    // le plus petit possible. Un noir franc ferait croire à une masse
    // nuageuse absente ; un blanc, à une éclaircie qui n'existe pas.
    // ⚠️  DEUX PASSES, PAS UNE CHAÎNE.
    //
    // `sharp(x).extend(...).extract(...)` ne fait PAS ce qu'on lit :
    // sharp ordonne ses opérations lui-même, et l'extraction est appliquée
    // à l'image d'ORIGINE, avant l'extension. Le résultat est un
    // « bad extract area » quand le cadre demandé dépasse — c'est-à-dire à
    // tous les coups. On matérialise donc l'image étendue avant d'y
    // découper. Une passe de plus, et le code fait ce qu'il dit.
    const etendu = await sharp(derniere)
      .extend({
        top: Math.max(0, dy), bottom: Math.max(0, -dy),
        left: Math.max(0, dx), right: Math.max(0, -dx),
        extendWith: 'copy'
      })
      .toBuffer();

    const image = await sharp(etendu)
      // ⚠️  L'EXTRACTION SE FAIT DU CÔTÉ OPPOSÉ À L'EXTENSION.
      //
      // On étend du côté d'où le contenu vient, et on découpe du côté où
      // il va. Pour dx > 0 on ajoute à gauche et on découpe à 0 ; pour
      // dx < 0 on ajoute à droite et on découpe à |dx|. D'où max(0, −dx)
      // et non max(0, dx) — le premier jet avait les deux à l'endroit, ce
      // qui donnait « bad extract area » dès que le vent portait vers
      // l'ouest, c'est-à-dire dans le cas le plus courant sous l'alizé.
      .extract({
        left: Math.max(0, -dx), top: Math.max(0, -dy),
        width: L, height: H
      })
      .composite([{ input: bandeau(L, H, minutes), top: 0, left: 0 }])
      .jpeg({ quality: 68, progressive: true })
      .toBuffer();

    await writeFile(join(dossierCible, nom), image);
    produites.push({ fichier: nom, horodatage: versHorodatage(quand), minutes });
  }

  const idx = {
    version: 1,
    // ⚠️  Ce champ existe pour que l'application ne PUISSE PAS confondre.
    nature: 'projection',
    avertissement: 'Images calculées par extrapolation du déplacement observé. '
      + 'Ce ne sont pas des observations satellite.',
    calculeeA: new Date().toISOString(),
    dernierObserve: noms[noms.length - 1].replace('.jpg', ''),
    cadence: CADENCE,
    mouvement: {
      dxPixels: mouvement.dx,
      dyPixels: mouvement.dy,
      dispersion: mouvement.dispersion,
      surImages: mouvement.images
    },
    images: produites
  };
  await writeFile(join(dossierCible, 'index.json'), JSON.stringify(idx), 'utf8');

  return { erreur: null, ...idx };
}

/** Vide le dossier de projection de ses JPEG et de son index. */
async function effacer(dossier) {
  try {
    for (const n of await readdir(dossier)) {
      if (n.endsWith('.jpg') || n === 'index.json') {
        await unlink(join(dossier, n)).catch(() => {});
      }
    }
  } catch {
    /* le dossier n'existe pas encore : rien à faire */
  }
}
