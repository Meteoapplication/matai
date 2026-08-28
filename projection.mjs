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

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  LA MESURE ÉTAIT AVEUGLE PAR CONSTRUCTION. VOICI LE CALCUL.
 *
 * Réglage d'origine : grille de 128, et comparaison de deux images
 * CONSÉCUTIVES, donc dix minutes d'écart. Ça ne pouvait pas marcher, et
 * l'arithmétique le dit sans qu'on ait besoin d'essayer :
 *
 *   l'image régionale fait 1233 × 1068 pixels, à 2 km le pixel ;
 *   réduite à 128, un pixel de grille vaut 1233/128 × 2 km ≈ 19,3 km ;
 *   un alizé de 16,5 nœuds pousse les nuages de 30,6 km/h,
 *   soit 5,1 km en dix minutes — c'est-à-dire 0,26 pixel de grille.
 *
 * La corrélation cherche des décalages ENTIERS. Zéro était donc la bonne
 * réponse. Pour voir un seul pixel bouger il fallait 19,3 km en dix
 * minutes, soit 116 km/h — un cyclone.
 *
 * ⚠️  ET CE N'ÉTAIT PAS SEULEMENT AVEUGLE : C'ÉTAIT FAUX DANS L'AUTRE SENS.
 *
 * Éprouvé sur des images fabriquées aux vraies dimensions, avec un
 * déplacement connu (voir tests/20-mouvement.js) :
 *
 *   ciel immobile ......... 0,00 / 0,00   ✓  (vrai 0 / 0)
 *   brise 8 nœuds ......... 0,00 / 0,00   ✗  (vrai 1,20 / 0,44)
 *   alizé 16 nœuds ........ 0,00 / 0,00   ✗  (vrai 2,40 / 0,87)
 *   coup de vent 35 nœuds . 9,63 / 0,00   ✗  (vrai 5,20 / 1,90)
 *
 * Faux dans quatre cas sur cinq. Et le dernier est le pire : par gros
 * temps, le premier pixel qui bascule vaut 9,63 pixels d'image, donc la
 * vitesse est SURESTIMÉE DE 85 %. La projection aurait annoncé un grain
 * une heure trop tôt — le seul moment où quelqu'un la regarde.
 *
 * ⚠️  DEUX LEVIERS, ET IL FAUT LES DEUX.
 *
 *   1. une grille plus fine : à 512, un pixel vaut 4,8 km ;
 *   2. un écart de temps plus long : quatre pas, soit quarante minutes,
 *      ce qui multiplie par quatre le déplacement à mesurer.
 *
 * Ensemble : l'alizé de 16 nœuds déplace 4 pixels de grille sur la base,
 * mesuré à 2,41 px d'image par pas contre 2,40 attendus. Les cinq cas
 * passent, bruit compris. Coût mesuré : 0,9 seconde.
 *
 * Le prix de l'écart long est une hypothèse : que le vent ne tourne pas
 * en quarante minutes. C'est raisonnable pour un alizé, moins pour un
 * grain — d'où la dispersion, qui refuse quand les paires divergent.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Côté de l'image réduite servant à la corrélation. */
const GRILLE = 512;

/**
 * Combien de pas séparent les deux images d'une paire.
 *
 * 4 pas × 10 minutes = 40 minutes de base. C'est ce qui rend le
 * déplacement mesurable ; le résultat est ensuite divisé par ce nombre
 * pour redevenir un déplacement PAR PAS.
 */
const ECART = 4;

/**
 * Décalage maximal cherché, en pixels de grille SUR LA BASE de 40 minutes.
 *
 * 16 pixels × 4,8 km = 77 km en quarante minutes, soit 116 km/h (62
 * nœuds). Au-delà on ne cherche pas : ce n'est plus un régime de vent,
 * c'est un défaut de mesure.
 */
const RECHERCHE = 16;

/**
 * Déplacement au-delà duquel on refuse de conclure, sur la base.
 *
 * Volontairement sous `RECHERCHE` : une mesure qui touche le bord de la
 * fenêtre de recherche n'est pas un minimum, c'est une saturation, et
 * elle vaudrait probablement davantage si on cherchait plus loin.
 * 14 pixels ≈ 67 km en quarante minutes, soit 101 km/h.
 */
const DECALAGE_MAX = 14;

/**
 * Écart maximal toléré entre les paires, en pixels de grille sur la base.
 *
 * 6 pixels ≈ 29 km de désaccord entre deux mesures du même vent. Au-delà,
 * le mouvement n'est pas cohérent d'une paire à l'autre — vent qui tourne,
 * nuages qui se forment sur place, image manquante — et on ne projette pas.
 */
const DISPERSION_MAX = 6;

/**
 * Variation relative de luminance moyenne au-delà de laquelle on considère
 * que c'est l'ÉCLAIREMENT qui change, et non le ciel.
 *
 * ⚠️  CE SEUIL N'EST PAS CHOISI AU JUGÉ. Voici la mesure.
 *
 * Luminance moyenne des ONZE IMAGES RÉELLEMENT PUBLIÉES le 28 août 2026,
 * relevée sur le site à la tombée de la nuit :
 *
 *     02 h 10  90,1      03 h 10  38,8
 *     02 h 20  82,1      03 h 20  29,7
 *     02 h 30  74,1      03 h 30  23,1
 *     02 h 40  66,2      03 h 40  19,4
 *     02 h 50  57,5      03 h 50  18,1
 *     03 h 00  48,3
 *
 * Soit, sur les paires de quarante minutes que la mesure utilise :
 *
 *     02:10→02:50  36 %      02:50→03:30  60 %
 *     02:20→03:00  41 %      03:00→03:40  60 %
 *     02:30→03:10  48 %      03:10→03:50  53 %
 *     02:40→03:20  55 %
 *
 * Trente-six pour cent au minimum, soixante au pire. En plein jour la
 * moyenne ne bouge que de quelques pour cent, et un ciel qui se couvre
 * franchement en donne moins de quinze (éprouvé dans tests/20-mouvement.js
 * à 8,7 % et 13,8 %, tous deux acceptés).
 *
 * 15 % tombe donc dans un fossé large : plus du double de ce qu'un front
 * produit, moins de la moitié de ce que produit le plus doux des
 * crépuscules. Ce n'est pas un réglage serré qu'il faudra retoucher.
 */
const ECLAIREMENT_MAX = 0.15;

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

/**
 * De combien la luminance moyenne a-t-elle changé entre deux images ?
 *
 * Rapportée à la plus claire des deux, pour que la mesure soit symétrique
 * et qu'une image presque noire ne fasse pas exploser le rapport.
 */
export function ecartEclairement(a, b) {
  const moyenne = (t) => {
    let s = 0;
    for (let i = 0; i < t.length; i += 7) s += t[i];
    return s / Math.ceil(t.length / 7);
  };
  const ma = moyenne(a), mb = moyenne(b);
  const haut = Math.max(ma, mb);
  if (haut <= 0) return 0;
  return Math.abs(ma - mb) / haut;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  UNE JOURNÉE QUI S'ASSOMBRIT FAIT LIRE LE VENT TROP FORT.
 *
 * La corrélation minimise une somme de différences absolues. Si la seconde
 * image est globalement plus sombre que la première, la somme baisse
 * partout où la zone commune contient MOINS de nuage — et le minimum
 * glisse vers un décalage plus grand que le vrai. Mesuré sur des images
 * fabriquées, alizé de 16 nœuds, vrai déplacement 4,0 / 1,7 en grille :
 *
 *     luminance stable ....  4 / 2   ✓
 *     −8,7 % en 40 min .....  5 / 2   ✗  (+25 % de vitesse)
 *     −14 % en 40 min ......  5 / 3   ✗  (+25 % et +76 %)
 *
 * Ce n'est pas le crépuscule — le garde-fou d'éclairement arrête celui-là.
 * C'est le ciel qui se couvre : exactement le moment où quelqu'un regarde
 * la projection, et exactement le sens d'erreur qui fait annoncer un grain
 * trop tôt.
 *
 * On remet donc les deux images à la même luminance moyenne avant de
 * comparer. Les trois cas rendent alors 4 / 2.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * @returns une COPIE de `autre` ramenée à la luminance moyenne de `ref`.
 */
export function normaliser(ref, autre) {
  const moyenne = (t) => {
    let s = 0;
    for (let i = 0; i < t.length; i += 7) s += t[i];
    return s / Math.ceil(t.length / 7);
  };
  const ma = moyenne(ref), mb = moyenne(autre);
  if (!(mb > 0) || !(ma > 0)) return autre;
  const k = ma / mb;
  if (Math.abs(k - 1) < 0.01) return autre;   // rien à corriger
  const sortie = Buffer.allocUnsafe(autre.length);
  for (let i = 0; i < autre.length; i++) {
    sortie[i] = Math.min(255, Math.round(autre[i] * k));
  }
  return sortie;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  LE DÉFAUT LE PLUS PROFOND N'EST PAS DANS LA MESURE : IL EST DANS LE
 *     MODÈLE. « TOUT LE CIEL SE DÉPLACE ENSEMBLE » EST FAUX.
 *
 * Toute cette machinerie repose sur une idée : mesurer UN déplacement, et
 * translater TOUTE l'image de ce déplacement-là. L'emprise régionale fait
 * 2 464 km sur 2 133 km. C'est la distance de Paris à Moscou.
 *
 * Mesuré le 28 août 2026 sur les images infrarouges réelles, en découpant
 * la région en seize tuiles et en cherchant le déplacement de chacune sur
 * une même paire de quarante minutes :
 *
 *     (-1,1)  (-2,3)  (0,4)  (-1,4)
 *     (2,0)   (0,0)   (3,3)  (-2,1)
 *     (0,0)   (0,0)   (0,0)  (0,0)
 *     (-1,-3) (3,-2)  (2,-1) (4,1)
 *
 * De −2 à +4 en x, de −3 à +4 en y. À 6 km le pixel, les tuiles sont en
 * désaccord de TRENTE-SIX KILOMÈTRES sur quarante minutes. Il n'existe
 * aucune translation unique qui décrive ce ciel : le nord-est descend, le
 * sud-ouest monte, le centre ne bouge pas.
 *
 * C'est normal, et c'était prévisible : la région traverse la zone de
 * convergence, la ceinture des alizés et vingt et un degrés de latitude.
 * Rien n'oblige un nuage des Marquises à faire ce que fait un nuage des
 * Australes.
 *
 * ⚠️  ET LA DISPERSION EXISTANTE NE VOIT PAS ÇA.
 *
 * `DISPERSION_MAX` compare les paires entre elles — c'est-à-dire dans le
 * TEMPS. Un ciel qui se déchire régulièrement, la moitié nord partant à
 * l'ouest et la moitié sud à l'est, donne quatre paires parfaitement
 * d'accord sur une moyenne qui ne décrit aucun endroit réel. La mesure
 * serait stable, cohérente, et fausse partout.
 *
 * D'où ce contrôle : on mesure aussi la cohérence dans l'ESPACE, et on
 * refuse quand les tuiles ne racontent pas la même histoire. Une
 * projection absente est lisible ; une projection qui déplace les
 * Marquises comme les Australes ne l'est pas.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * @returns les déplacements de chaque tuile, en pixels de grille.
 */
export function decalageParTuiles(a, b, taille = GRILLE, cotes = 3, recherche = 8) {
  const tw = Math.floor(taille / cotes);
  const out = [];
  for (let ty = 0; ty < cotes; ty++) {
    for (let tx = 0; tx < cotes; tx++) {
      const x0 = tx * tw, y0 = ty * tw;
      let meilleur = { dx: 0, dy: 0, cout: Infinity };
      for (let dy = -recherche; dy <= recherche; dy++) {
        for (let dx = -recherche; dx <= recherche; dx++) {
          let somme = 0, n = 0;
          for (let y = y0; y < y0 + tw; y += 2) {
            const yy = y + dy;
            if (yy < 0 || yy >= taille) continue;
            for (let x = x0; x < x0 + tw; x += 2) {
              const xx = x + dx;
              if (xx < 0 || xx >= taille) continue;
              somme += Math.abs(a[y * taille + x] - b[yy * taille + xx]);
              n++;
            }
          }
          // Une tuile trop rognée par le décalage ne se compare plus à
          // grand-chose : on ne la laisse pas gagner par manque de pixels.
          if (n < (tw * tw) / 6) continue;
          const cout = somme / n;
          if (cout < meilleur.cout) meilleur = { dx, dy, cout };
        }
      }
      out.push({ dx: meilleur.dx, dy: meilleur.dy });
    }
  }
  return out;
}

/**
 * De combien les tuiles se contredisent-elles, en pixels de grille ?
 *
 * On prend l'étendue (max − min) sur chaque axe et on garde la pire. Pas
 * l'écart-type : une seule tuile qui part de travers suffit à rendre la
 * translation fausse là où elle est, et c'est précisément l'endroit où
 * quelqu'un habite.
 */
export function desaccordSpatial(tuiles) {
  if (!tuiles || tuiles.length < 4) return 0;
  const dxs = tuiles.map((t) => t.dx), dys = tuiles.map((t) => t.dy);
  return Math.max(
    Math.max(...dxs) - Math.min(...dxs),
    Math.max(...dys) - Math.min(...dys)
  );
}

/**
 * Désaccord maximal toléré entre les tuiles, en pixels de grille.
 *
 * 4 pixels × 4,8 km = 19 km d'écart entre deux coins de la région sur une
 * base de quarante minutes. Au-delà, les morceaux du ciel ne vont pas au
 * même endroit et une translation unique en déplacerait au moins un dans
 * la mauvaise direction.
 *
 * Repère mesuré : un champ uniforme donne 0 ou 1 ; le vrai ciel du
 * 28 août donnait 6.
 */
const DESACCORD_MAX = 4;

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
  // Il faut ECART + 2 images pour former au moins deux paires espacées.
  if (!fichiers || fichiers.length < ECART + 2) return null;

  // ⚠️  ON NE COMPARE PLUS DEUX IMAGES CONSÉCUTIVES.
  //
  // Chaque paire est faite d'images séparées de ECART pas — quarante
  // minutes — parce qu'en dix minutes le déplacement est plus petit qu'un
  // pixel de grille et que la corrélation ne cherche que des entiers. Voir
  // le calcul en tête de fichier : c'est ce qui a rendu la projection
  // muette depuis le premier jour.
  //
  // Les paires les plus récentes d'abord : le mouvement d'il y a deux
  // heures n'a pas à peser sur une projection de l'heure qui vient.
  const n = fichiers.length;
  const paires = [];
  for (let i = n - 1; i - ECART >= 0 && paires.length < PAIRES; i--) {
    paires.push([fichiers[i - ECART], fichiers[i]]);
  }
  if (paires.length < 2) return null;

  // Les images sont lues une seule fois chacune, même quand deux paires
  // les partagent : à 512 × 512, chaque lecture coûte un décodage JPEG.
  const cache = new Map();
  const gris = async (f) => {
    if (!cache.has(f)) cache.set(f, await enGris(sharp, f));
    return cache.get(f);
  };

  const dxs = [], dys = [];
  let pireEclairement = 0;
  let tuiles = null;
  for (const [avant, apres] of paires) {
    const ga = await gris(avant), gb = await gris(apres);

    // ⚠️  L'ÉCLAIREMENT D'ABORD : SI LA NUIT ARRIVE, RIEN D'AUTRE NE COMPTE.
    const ecart = ecartEclairement(ga, gb);
    if (ecart > pireEclairement) pireEclairement = ecart;

    // ⚠️  On compare à luminance égale, sinon un ciel qui se couvre fait
    // lire le vent 25 % trop fort. Voir `normaliser`.
    const gbn = normaliser(ga, gb);
    const d = decalage(ga, gbn);
    dxs.push(d.dx);
    dys.push(d.dy);

    // La cohérence spatiale se juge sur la paire la PLUS RÉCENTE — c'est
    // celle dont on va prolonger le mouvement. Une seule suffit : le
    // découpage en tuiles coûte autant que la mesure globale.
    if (tuiles === null) tuiles = decalageParTuiles(ga, gbn);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️  À L'AUBE ET AU CRÉPUSCULE, LA CORRÉLATION SUIT LE TERMINATEUR,
  //     PAS LES NUAGES.
  //
  // Relevé le 28 août 2026 sur les images réellement publiées, luminance
  // moyenne par bandes verticales, d'ouest en est :
  //
  //     01 h 50 UTC   119 116 122 105  92 102  95  85
  //     02 h 30 UTC   124 120 123 100  56  39  22  16
  //     03 h 00 UTC   126 101  68  33  13  15  19  19
  //
  // C'est la nuit qui traverse l'image. La frontière jour/nuit balaie le
  // Pacifique à environ 1 600 km/h — cinquante fois la vitesse d'un alizé
  // — et c'est de très loin le bord le plus contrasté de la scène. Une
  // corrélation qui cherche « ce qui s'est déplacé » trouve donc l'ombre,
  // et rien d'autre.
  //
  // La mesure de ce passage-là le montre sans ambiguïté :
  //
  //     dx [-16, -15, -16, -3] · dy [-10, -10, -8, -3] · dispersion 13
  //
  // Le −16 est EXACTEMENT la limite de recherche : la mesure sature. Elle
  // rend « au moins 116 km/h vers l'ouest » quand le vent est de 16 nœuds.
  // C'est la bonne réponse à la mauvaise question.
  //
  // On ne peut pas corriger ça par un réglage : sur une image en lumière
  // visible, aux heures où le soleil se lève ou se couche, il n'y a pas de
  // mouvement de nuage mesurable sous celui de l'ombre. Le vrai remède est
  // l'infrarouge, qui ne connaît pas de terminateur — c'est un changement
  // de source d'images, et de ce que les gens verront à l'écran.
  //
  // En attendant, on refuse, et on le dit. Un refus expliqué vaut mieux
  // qu'une projection qui déplace tout le ciel de cent kilomètres.
  // ═══════════════════════════════════════════════════════════════════════
  if (pireEclairement > ECLAIREMENT_MAX) {
    return {
      refus: 'éclairement en train de changer (aube ou crépuscule) — '
        + 'la corrélation suivrait la frontière jour/nuit et non les nuages',
      eclairement: Math.round(pireEclairement * 100) / 100,
      dxs, dys
    };
  }

  // Tout ce qui suit est en pixels de grille SUR LA BASE de ECART pas.
  const dxBase = mediane(dxs);
  const dyBase = mediane(dys);

  // ⚠️  Trois refus, et ils comptent autant que le calcul lui-même.
  const dispersion = Math.max(
    Math.max(...dxs) - Math.min(...dxs),
    Math.max(...dys) - Math.min(...dys)
  );
  if (dispersion > DISPERSION_MAX) {
    return { refus: 'mouvement incohérent d’une paire à l’autre', dispersion, dxs, dys };
  }

  // ⚠️  ET LA COHÉRENCE DANS L'ESPACE, qui est un contrôle DIFFÉRENT de
  // celui du dessus. Voir le long commentaire de `decalageParTuiles` : la
  // dispersion compare les instants, celle-ci compare les endroits. Un
  // ciel qui se déchire proprement passe la première et échoue ici.
  const desaccord = desaccordSpatial(tuiles);
  if (desaccord > DESACCORD_MAX) {
    return {
      refus: 'le ciel ne se déplace pas d’un seul bloc — les morceaux de la '
        + 'région vont dans des directions différentes, aucune translation '
        + 'unique ne les décrit',
      desaccord,
      tuiles,
      dispersion, dxs, dys
    };
  }
  if (Math.abs(dxBase) > DECALAGE_MAX || Math.abs(dyBase) > DECALAGE_MAX) {
    return { refus: 'déplacement aberrant', dx: dxBase, dy: dyBase };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️  UN DÉPLACEMENT EXACTEMENT NUL N'EST PAS UNE MESURE, C'EST UN
  //     SILENCE — ET AVEC LA GRILLE CORRIGÉE, C'EN EST UN VRAI.
  //
  // Avec l'ancien réglage, zéro était la réponse normale par tout temps :
  // ce refus aurait tout bloqué. Maintenant qu'un pixel de grille vaut
  // 4,8 km sur quarante minutes, un zéro franc signifie moins de 2,4 km
  // parcourus en quarante minutes, soit moins de 4 km/h. C'est un calme
  // plat, et c'est alors légitime de ne rien projeter.
  //
  // Ce qu'on refuse d'abord, c'est de publier six copies de la dernière
  // image observée sous un bandeau « PROJECTION · +60 min ». Une photo du
  // passé présentée comme une prévision est exactement ce que le point 8
  // du cahier des charges interdit, et l'écran sait déjà dire « pas de
  // projection ».
  // ═══════════════════════════════════════════════════════════════════════
  if (dxBase === 0 && dyBase === 0 && dispersion === 0) {
    return {
      refus: 'déplacement nul sur toutes les paires — ciel sans mouvement décelable',
      dx: 0, dy: 0, dispersion, dxs, dys
    };
  }

  // On redivise par l'écart : le reste du code attend un déplacement PAR
  // PAS de dix minutes. Il reste fractionnaire — c'est là que se gagne la
  // précision, et l'arrondi n'a lieu qu'au moment de décaler l'image.
  return {
    dx: dxBase / ECART,
    dy: dyBase / ECART,
    dxBase, dyBase, ecart: ECART,
    dispersion, dxs, dys,
    desaccord: desaccordSpatial(tuiles),
    images: cache.size
  };
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
/**
 * ⚠️  L'INDEX PORTE DES CHEMINS, PAS DES NOMS DE FICHIERS.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * `animation.mjs` écrit dans son index :
 *
 *     { "fichier": "nuages/anim/20262400110.jpg", "t": "…" }
 *
 * — un chemin relatif à `paquets/`, parce que c'est l'application qui le
 * consomme et qui le colle derrière l'adresse du site. Ce code-ci prenait
 * ce champ pour un simple nom de fichier et le recollait derrière le
 * dossier source :
 *
 *     join('paquets/nuages/anim', 'nuages/anim/20262400110.jpg')
 *       → paquets/nuages/anim/nuages/anim/20262400110.jpg
 *
 * Le chemin doublé n'existe pas, `sharp` refuse, et la projection est
 * abandonnée. Silencieusement : `build.mjs` attrape l'erreur — c'est
 * voulu, un satellite qui tombe ne doit pas arrêter les prévisions — et
 * écrit une ligne de journal que personne ne lit tant que tout est vert.
 *
 * Résultat : le point 6 du cahier des charges, la projection à une heure,
 * n'a JAMAIS été publié une seule fois en production. L'animation
 * marchait, les tests passaient, l'écran affichait poliment « pas encore
 * de projection », et rien n'était faux — sauf que la fonctionnalité
 * n'existait pas.
 *
 * Aucun banc ne pouvait le voir : les essais fabriquent leur index avec
 * des noms nus, parce que c'est ce que ce code attendait. Le banc a
 * éprouvé l'accord du code avec lui-même. Il a fallu lire une ligne de
 * journal d'un vrai passage.
 *
 * On ne garde donc que le dernier segment, quelle que soit la forme reçue.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * @param index  l'index de l'animation, tel qu'`animation.mjs` l'écrit
 * @returns les noms de fichiers nus, en ordre chronologique
 */
export function nomsDepuisIndex(index) {
  if (!index || !Array.isArray(index.images)) return [];
  return index.images
    .map((x) => (typeof x === 'string' ? x : (x && (x.fichier || x.horodatage))))
    .filter(Boolean)
    // ⚠️  `basename` ne coupe QUE le séparateur de la plateforme. Sur le
    // serveur GitHub, qui est un Linux, il laisserait passer intact un
    // « nuages\\anim\\xxx.jpg » écrit depuis Windows — et le projet se
    // développe sous Windows. On coupe donc sur les deux séparateurs,
    // quelle que soit la machine qui a écrit l'index.
    .map((n) => String(n).split(/[\\/]/).pop())
    .map((n) => (n.endsWith('.jpg') ? n : n + '.jpg'))
    .sort();
}

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
  const noms = nomsDepuisIndex(index);

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
