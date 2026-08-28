/**
 * La mesure du mouvement, éprouvée contre un déplacement CONNU.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Ce test fabrique des images de nuages aux VRAIES dimensions du recadrage
 * régional — 1233 × 1068 à 2 km le pixel — et les fait glisser d'une
 * quantité qu'il connaît. Puis il demande à `mesurerMouvement` de la
 * retrouver.
 *
 * ⚠️  POURQUOI IL FALLAIT EN ARRIVER LÀ.
 *
 * La projection a tourné pour la première fois le 28 août 2026, après deux
 * autres défauts corrigés. Elle a rendu :
 *
 *     mouvement : dx 0, dy 0, dispersion 0 — sur cinq paires
 *
 * Zéro. Pas un ciel immobile : le vent était de 16,5 nœuds. L'ancien
 * réglage — grille de 128, images consécutives — donnait un pixel de
 * grille valant 19,3 km, quand l'alizé n'en parcourt que 5,1 en dix
 * minutes. La corrélation cherche des entiers : zéro ÉTAIT la bonne
 * réponse. Il fallait 116 km/h pour voir un seul pixel bouger.
 *
 * Et l'autre bout est pire. Par gros temps, le premier pixel qui bascule
 * vaut 9,63 pixels d'image : à 35 nœuds la mesure rendait 9,63 au lieu de
 * 5,20, soit 85 % TROP RAPIDE. La projection aurait annoncé un grain une
 * heure trop tôt — précisément le jour où quelqu'un la regarde.
 *
 * Aucun banc ne pouvait le voir : les essais d'alors fabriquaient de
 * petites images avec de gros décalages, c'est-à-dire un monde où le
 * réglage marchait. Le seul juge honnête est une image aux dimensions
 * réelles, déplacée d'une distance réelle.
 *
 * Réglage corrigé : grille de 512 (4,8 km le pixel) et paires espacées de
 * quatre pas (quarante minutes), ce qui multiplie par quatre ce qu'il y a
 * à voir. Les cinq régimes ci-dessous passent, bruit compris.
 * ═══════════════════════════════════════════════════════════════════════
 */

const path = require('path');

/** Les dimensions et l'échelle relevées sur un paquet de production. */
const L = 1233, H = 1068, KM_PAR_PIXEL = 2;

/** Un champ de nuages : des amas gaussiens, reproductibles. */
function champ(n = 90, graine = 1) {
  let s = graine;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: n }, () => ({
    x: rnd() * L, y: rnd() * H, r: 40 + rnd() * 160, a: 0.4 + rnd() * 0.6
  }));
}

/**
 * Rend le champ décalé de (dx, dy) pixels, avec un peu de bruit optionnel.
 *
 * `eclairement`, s'il est fourni, est une fonction (x) → facteur entre 0 et
 * 1 appliquée à la fin : elle sert à fabriquer une nuit qui traverse
 * l'image, ou une journée qui se couvre uniformément.
 */
function rendre(sharp, amas, dx, dy, bruit, graine, eclairement) {
  let s = graine;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const px = Buffer.alloc(L * H, 30);            // fond sombre : la mer
  for (const c of amas) {
    const cx = c.x + dx, cy = c.y + dy, r2 = c.r * c.r;
    const x0 = Math.max(0, Math.floor(cx - c.r)), x1 = Math.min(L, Math.ceil(cx + c.r));
    const y0 = Math.max(0, Math.floor(cy - c.r)), y1 = Math.min(H, Math.ceil(cy + c.r));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > r2) continue;
        const i = y * L + x;
        px[i] = Math.min(255, px[i] + Math.exp(-d2 / (r2 * 0.35)) * 225 * c.a);
      }
    }
  }
  if (bruit) {
    for (let i = 0; i < px.length; i += 3) {
      px[i] = Math.max(0, Math.min(255, px[i] + (rnd() - 0.5) * bruit));
    }
  }
  if (eclairement) {
    // Une colonne à la fois : le facteur ne dépend que de x.
    for (let x = 0; x < L; x++) {
      const f = eclairement(x);
      if (f >= 0.999) continue;
      for (let y = 0; y < H; y++) px[y * L + x] = Math.round(px[y * L + x] * f);
    }
  }
  return sharp(px, { raw: { width: L, height: H, channels: 1 } })
    .jpeg({ quality: 76 }).toBuffer();
}

/**
 * Les régimes éprouvés. `vx`/`vy` sont en pixels d'image PAR PAS de dix
 * minutes — c'est ce que la mesure doit retrouver.
 *
 * Repère : 1 pixel = 2 km, donc 2,4 px/pas = 4,8 km / 10 min = 28,8 km/h
 * ≈ 16 nœuds. Le cap est d'environ 110°, comme un alizé d'est-sud-est.
 */
const REGIMES = [
  { nom: 'ciel immobile',       vx: 0,    vy: 0,    bruit: 0,  refus: true },
  { nom: 'brise 8 nœuds',       vx: 1.20, vy: 0.44, bruit: 0,  refus: false },
  { nom: 'alizé 16 nœuds',      vx: 2.40, vy: 0.87, bruit: 0,  refus: false },
  { nom: 'alizé 16 nœuds bruité', vx: 2.40, vy: 0.87, bruit: 40, refus: false },
  { nom: 'coup de vent 35 nœuds', vx: 5.20, vy: 1.90, bruit: 0, refus: false }
];

/** Tolérance : un demi-pixel de grille par pas, plus une marge de JPEG. */
const TOLERANCE = 0.75;

module.exports = async function () {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    return { saute: 'sharp absent' };
  }

  const os = require('os');
  const fs = require('fs');
  const { writeFile, mkdtemp, rm } = require('fs/promises');

  const P = await import(
    'file://' + path.resolve(__dirname, '..', 'projection.mjs')
  );

  const fautes = [];
  const notes = [];
  const dossier = await mkdtemp(path.join(os.tmpdir(), 'matai-mouvement-'));

  try {
    const amas = champ();
    let etalon = null;

    for (const r of REGIMES) {
      // Neuf images : de quoi former quatre paires espacées de quatre pas.
      const chemins = [];
      for (let i = 0; i < 9; i++) {
        const f = path.join(dossier, r.nom.replace(/\W/g, '_') + '-' + i + '.jpg');
        await writeFile(f, await rendre(sharp, amas, i * r.vx, i * r.vy, r.bruit, 7 + i));
        chemins.push(f);
      }

      const m = await P.mesurerMouvement(sharp, chemins);

      if (!m) {
        fautes.push(r.nom + ' : aucune mesure rendue sur 9 images');
        continue;
      }

      if (r.refus) {
        if (!m.refus) {
          fautes.push('« ' + r.nom + ' » aurait dû être refusé, la mesure rend '
            + m.dx + ' / ' + m.dy + ' — six copies de la dernière image seraient '
            + 'publiées sous un bandeau « PROJECTION »');
        } else {
          notes.push(r.nom + ' → refusé : ' + m.refus);
        }
        continue;
      }

      if (m.refus) {
        fautes.push('« ' + r.nom + ' » a été refusé (' + m.refus + ') alors que '
          + 'le mouvement est réel : la projection ne sortirait jamais');
        continue;
      }

      // `dx`/`dy` sont en pixels de GRILLE par pas ; on les ramène en
      // pixels d'image, comme le fait `produireProjection`.
      const kx = L / 512, ky = H / 512;
      const vuX = m.dx * kx, vuY = m.dy * ky;

      if (Math.abs(vuX - r.vx) > TOLERANCE) {
        fautes.push(r.nom + ' : ' + vuX.toFixed(2) + ' px/pas en x au lieu de '
          + r.vx + ' — écart de ' + Math.abs(vuX - r.vx).toFixed(2));
      }
      if (Math.abs(vuY - r.vy) > TOLERANCE) {
        fautes.push(r.nom + ' : ' + vuY.toFixed(2) + ' px/pas en y au lieu de '
          + r.vy + ' — écart de ' + Math.abs(vuY - r.vy).toFixed(2));
      }

      // On garde la lecture de l'alizé à luminance stable : c'est l'étalon
      // auquel les ciels qui s'assombrissent seront comparés plus bas.
      if (r.nom === 'alizé 16 nœuds') { etalon = { x: vuX, y: vuY }; }

      const kmh = Math.hypot(vuX, vuY) * KM_PAR_PIXEL * 6;
      notes.push(r.nom + ' → ' + vuX.toFixed(2) + ' / ' + vuY.toFixed(2)
        + ' px/pas (vrai ' + r.vx + ' / ' + r.vy + ') ≈ ' + kmh.toFixed(0) + ' km/h');
    }

    // ═══════════════════════════════════════════════════════════════════
    // ⚠️  LA NUIT QUI TRAVERSE L'IMAGE DOIT ÊTRE REFUSÉE.
    //
    // C'est le défaut qui a fait échouer le premier passage où la mesure
    // corrigée a tourné en production, le 28 août 2026 :
    //
    //     dx [-16, -15, -16, -3] · dy [-10, -10, -8, -3] · dispersion 13
    //
    // −16 est exactement la limite de recherche : la corrélation saturait.
    // Elle ne suivait pas les nuages, elle suivait le terminateur — la
    // frontière jour/nuit, qui balaie le Pacifique à 1 600 km/h, cinquante
    // fois la vitesse d'un alizé, et qui est de très loin le bord le plus
    // contrasté de la scène.
    //
    // Ce qui suit reproduit exactement ça : le MÊME alizé que ci-dessus,
    // avec en plus une nuit qui entre par l'est. Si le refus disparaît un
    // jour, la projection recommencera à déplacer tout le ciel de cent
    // kilomètres vers l'ouest, deux fois par jour, sous un bandeau
    // « PROJECTION ». Le refus par dispersion ne suffit PAS à rattraper le
    // coup : il dépend de l'endroit où la nuit se trouve dans le cadre, et
    // la 4ᵉ paire ci-dessus (−3) montre qu'il peut très bien ne pas
    // se déclencher.
    // ═══════════════════════════════════════════════════════════════════
    {
      const chemins = [];
      for (let i = 0; i < 9; i++) {
        // Le front de nuit part de l'est (x grand) et balaie vers l'ouest.
        const xt = L * (1.15 - i * 0.14);
        const nuit = (x) => (x < xt ? 1 : 0.06);
        const f = path.join(dossier, 'terminateur-' + i + '.jpg');
        await writeFile(f, await rendre(sharp, amas, i * 2.40, i * 0.87, 0, 7 + i, nuit));
        chemins.push(f);
      }

      const m = await P.mesurerMouvement(sharp, chemins);
      if (!m) {
        fautes.push('crépuscule : aucune mesure rendue sur 9 images');
      } else if (!m.refus) {
        fautes.push('LE CRÉPUSCULE N’EST PLUS REFUSÉ : la mesure rend '
          + m.dx + ' / ' + m.dy + ' (paires ' + JSON.stringify(m.dxs) + ') — '
          + 'c’est le terminateur qui est suivi, pas les nuages, et la '
          + 'projection décalerait tout le ciel de cent kilomètres');
      } else if (!/éclairement/.test(m.refus)) {
        fautes.push('le crépuscule est refusé, mais pour la mauvaise raison : « '
          + m.refus + ' ». Le motif tient à l’endroit où la nuit se trouve dans '
          + 'le cadre ; il ne se déclenchera pas à tous les crépuscules');
      } else {
        notes.push('crépuscule → refusé : ' + m.refus
          + ' (écart d’éclairement ' + m.eclairement + ')');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ── ET UNE JOURNÉE QUI SE COUVRE DOIT PASSER, SANS ÊTRE LUE TROP VITE.
    //
    // Le garde-fou ci-dessus vaut par ce qu'il laisse passer. Un ciel qui
    // s'assombrit uniformément — l'arrivée d'un front, exactement le moment
    // où la projection sert à quelque chose — ne doit pas être confondu
    // avec la tombée de la nuit.
    //
    // ⚠️  ET IL NE SUFFIT PAS QU'IL PASSE : IL DOIT PASSER JUSTE.
    //
    // La somme des différences absolues baisse partout où la zone commune
    // contient moins de nuage. Quand la seconde image est plus sombre, le
    // minimum glisse donc vers un décalage plus grand que le vrai. Mesuré
    // sur ce décor même, avant que `normaliser` n'existe :
    //
    //     luminance stable ..... 4 / 2  en grille   ✓ (vrai 4,0 / 1,7)
    //     −8,7 % en 40 min ..... 5 / 2               ✗ (+25 %)
    //     −14 % en 40 min ...... 5 / 3               ✗ (+25 % et +76 %)
    //
    // Vingt-cinq pour cent trop vite, dans le sens qui annonce le grain
    // trop tôt. Deux régimes sont éprouvés ici, dont un juste sous le seuil
    // d'éclairement : c'est là que le défaut était le plus fort et que le
    // refus ne rattrapait rien.
    // ═══════════════════════════════════════════════════════════════════
    for (const [quoi, parPas] of [['−8,7 %', 0.02], ['−13,8 %', 0.032]]) {
      const chemins = [];
      for (let i = 0; i < 9; i++) {
        const f = path.join(dossier, 'couvert-' + parPas + '-' + i + '.jpg');
        const baisse = () => 1 - parPas * i;
        await writeFile(f, await rendre(sharp, amas, i * 2.40, i * 0.87, 0, 7 + i, baisse));
        chemins.push(f);
      }

      const m = await P.mesurerMouvement(sharp, chemins);
      if (!m || m.refus) {
        fautes.push('une journée qui se couvre (' + quoi + ' de luminance sur '
          + 'quarante minutes) est refusée : « ' + ((m && m.refus) || 'aucune mesure')
          + ' ». Le seuil d’éclairement est trop serré — la projection '
          + 'disparaîtrait précisément quand un front arrive');
        continue;
      }

      const vuX = m.dx * (L / 512), vuY = m.dy * (H / 512);

      // ⚠️  ON COMPARE À L'ÉTALON, PAS À LA VÉRITÉ — ET AVEC UNE TOLÉRANCE
      //     BIEN PLUS SERRÉE QUE LE RESTE DU FICHIER.
      //
      // Le décor est le MÊME que celui de l'alizé de 16 nœuds : mêmes amas,
      // même déplacement, seule la luminance change. La bonne question n'est
      // donc pas « est-ce à peu près juste ? » mais « la baisse de luminance
      // a-t-elle changé la réponse ? ». La réponse doit être non.
      //
      // C'est important : avec la tolérance ordinaire de 0,75 px, ce test
      // laissait passer le défaut. Sans remise à niveau, la lecture était de
      // 3,01 au lieu de 2,41 — 25 % trop vite, et 0,60 px d'écart, soit
      // juste sous la barre. Il a fallu saboter le module pour s'en
      // apercevoir : le test « passait » en décrivant un monde faux.
      if (!etalon) {
        fautes.push('l’étalon (alizé à luminance stable) n’a pas été mesuré : '
          + 'la comparaison ci-dessous ne peut pas se faire');
        continue;
      }
      const SERRE = 0.25;
      if (Math.abs(vuX - etalon.x) > SERRE || Math.abs(vuY - etalon.y) > SERRE) {
        fautes.push('ciel qui se couvre (' + quoi + ') : ' + vuX.toFixed(2) + ' / '
          + vuY.toFixed(2) + ' px/pas, contre ' + etalon.x.toFixed(2) + ' / '
          + etalon.y.toFixed(2) + ' pour le MÊME ciel à luminance stable. La '
          + 'baisse de luminance déplace le minimum de corrélation : le vent '
          + 'est lu ' + (vuX > etalon.x ? 'TROP FORT' : 'trop faible')
          + ', et la projection annoncerait le grain '
          + (vuX > etalon.x ? 'trop tôt' : 'trop tard'));
      } else {
        notes.push('ciel qui se couvre (' + quoi + ') → passe, ' + vuX.toFixed(2)
          + ' / ' + vuY.toFixed(2) + ' px/pas — identique au ciel stable');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ⚠️  UN CIEL QUI SE DÉCHIRE DOIT ÊTRE REFUSÉ — ET LA DISPERSION NE LE
    //     VOIT PAS.
    //
    // C'est le défaut le plus profond de cette fonctionnalité, et il n'est
    // pas dans la mesure : il est dans le MODÈLE. Tout repose sur l'idée
    // qu'on peut mesurer un déplacement et translater toute l'image. Or
    // l'emprise régionale fait 2 464 km — Paris-Moscou.
    //
    // Mesuré le 28 août 2026 sur les VRAIES images infrarouges, seize
    // tuiles sur une même paire de quarante minutes : dx de −2 à +4, dy de
    // −3 à +4. Trente-six kilomètres de désaccord. Le nord-est descendait,
    // le sud-ouest montait, le centre ne bougeait pas.
    //
    // Ce que ce cas fabrique : un ciel dont la moitié gauche part vers
    // l'ouest et la moitié droite vers l'est, RÉGULIÈREMENT. Les quatre
    // paires sont alors parfaitement d'accord entre elles — la dispersion
    // vaut zéro, le contrôle du temps est content — et la médiane décrit
    // un mouvement qui n'a lieu NULLE PART.
    //
    // Sans le contrôle spatial, on publierait six images translatées d'un
    // vecteur moyen : la moitié de la région déplacée dans la mauvaise
    // direction, sous un bandeau « PROJECTION ».
    // ═══════════════════════════════════════════════════════════════════
    {
      const gauche = champ(45, 3).map((c) => ({ ...c, x: c.x * 0.5 }));
      const droite = champ(45, 9).map((c) => ({ ...c, x: L * 0.5 + c.x * 0.5 }));

      const chemins = [];
      for (let i = 0; i < 9; i++) {
        // Chaque moitié bouge d'un vecteur constant, mais PAS le même.
        const amasI = [
          ...gauche.map((c) => ({ ...c, x: c.x - i * 2.6, y: c.y + i * 0.9 })),
          ...droite.map((c) => ({ ...c, x: c.x + i * 2.6, y: c.y - i * 0.9 }))
        ];
        const f = path.join(dossier, 'dechire-' + i + '.jpg');
        await writeFile(f, await rendre(sharp, amasI, 0, 0, 0, 7 + i));
        chemins.push(f);
      }

      const m = await P.mesurerMouvement(sharp, chemins);
      if (!m) {
        fautes.push('ciel déchiré : aucune mesure rendue sur 9 images');
      } else if (!m.refus) {
        fautes.push('UN CIEL QUI SE DÉCHIRE N’EST PAS REFUSÉ : la mesure rend '
          + m.dx.toFixed(2) + ' / ' + m.dy.toFixed(2) + ' (dispersion '
          + m.dispersion + ', désaccord entre tuiles ' + m.desaccord + '). '
          + 'La moitié de la région serait déplacée dans la mauvaise '
          + 'direction sous un bandeau « PROJECTION »');
      } else if (!/seul bloc/.test(m.refus)) {
        notes.push('ciel déchiré → refusé par « ' + m.refus + ' » : le contrôle '
          + 'spatial n’a pas eu à servir sur ce cas-ci');
      } else {
        notes.push('ciel déchiré → refusé : désaccord entre tuiles ' + m.desaccord
          + ' (seuil 4), alors que la dispersion dans le temps valait '
          + m.dispersion + ' — elle seule aurait laissé passer');
      }
    }

    // ── et un ciel qui se déplace VRAIMENT d'un bloc ne doit pas être pris
    //    pour un ciel déchiré. Le garde-fou vaut par ce qu'il laisse passer.
    {
      const chemins = [];
      for (let i = 0; i < 9; i++) {
        const f = path.join(dossier, 'bloc-' + i + '.jpg');
        await writeFile(f, await rendre(sharp, amas, i * 2.40, i * 0.87, 0, 7 + i));
        chemins.push(f);
      }
      const m = await P.mesurerMouvement(sharp, chemins);
      if (!m || m.refus) {
        fautes.push('un alizé uniforme est refusé : « '
          + ((m && m.refus) || 'aucune mesure') + ' » — le seuil de désaccord '
          + 'est trop serré et plus aucune projection ne sortirait jamais');
      } else if (m.desaccord > 1) {
        fautes.push('un alizé uniforme donne un désaccord entre tuiles de '
          + m.desaccord + ' : le repère du seuil (0 ou 1 sur un champ '
          + 'uniforme) ne tient plus, et le seuil de 4 ne veut plus rien dire');
      } else {
        notes.push('alizé uniforme → désaccord entre tuiles ' + m.desaccord + ', accepté');
      }
    }

    // Et les garde-fous doivent être DANS le module, pas seulement ici.
    {
      const src = fs.readFileSync(path.resolve(__dirname, '..', 'projection.mjs'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (!/desaccord\s*>\s*DESACCORD_MAX/.test(src)) {
        fautes.push('projection.mjs ne contrôle plus la cohérence SPATIALE : '
          + 'un ciel qui se déchire régulièrement passerait la dispersion, qui '
          + 'ne compare que les instants');
      }
      if (!/decalage\(\s*ga\s*,\s*gbn\s*\)/.test(src) || !/normaliser\(ga,\s*gb\)/.test(src)) {
        fautes.push('projection.mjs ne remet plus les deux images à la même '
          + 'luminance avant de corréler : un ciel qui se couvre sera lu 25 % '
          + 'trop vite');
      }
    }

    // Et le garde-fou doit être DANS le module, pas seulement ici.
    {
      const src = fs.readFileSync(path.resolve(__dirname, '..', 'projection.mjs'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (!/pireEclairement\s*>\s*ECLAIREMENT_MAX/.test(src)) {
        fautes.push('projection.mjs ne refuse plus sur l’éclairement : à l’aube '
          + 'et au crépuscule la corrélation suivra de nouveau le terminateur');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ET L'ANCIEN RÉGLAGE DOIT RESTER MORT.
    //
    // On rejoue la corrélation avec la grille de 128 sur des images
    // consécutives — le réglage qui a rendu la projection muette pendant
    // toute son existence — et on vérifie qu'il rend bien zéro sur un
    // alizé ordinaire. Si ce jour-là il se met à trouver quelque chose,
    // c'est que le décor de ce test a changé et que le reste ne prouve
    // plus ce qu'on croit.
    // ═══════════════════════════════════════════════════════════════════
    const a = path.join(dossier, 'ancien-0.jpg');
    const b = path.join(dossier, 'ancien-1.jpg');
    await writeFile(a, await rendre(sharp, amas, 0, 0, 0, 7));
    await writeFile(b, await rendre(sharp, amas, 2.40, 0.87, 0, 8));
    const gris = async (f) => sharp(f).resize(128, 128, { fit: 'fill' })
      .greyscale().raw().toBuffer();
    const vieux = P.decalage(await gris(a), await gris(b), 128, 16);
    if (vieux.dx !== 0 || vieux.dy !== 0) {
      fautes.push('la grille de 128 sur deux images consécutives rend désormais ('
        + vieux.dx + ',' + vieux.dy + ') : le décor du test a changé, les '
        + 'chiffres ci-dessus ne démontrent plus le même défaut');
    }
    notes.push('l’ancien réglage rend toujours (0,0) sur un alizé : c’est bien lui le défaut');
  } finally {
    await rm(dossier, { recursive: true, force: true }).catch(() => {});
  }

  return { notes, fautes };
};
