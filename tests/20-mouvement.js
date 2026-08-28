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

/** Rend le champ décalé de (dx, dy) pixels, avec un peu de bruit optionnel. */
function rendre(sharp, amas, dx, dy, bruit, graine) {
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

      const kmh = Math.hypot(vuX, vuY) * KM_PAR_PIXEL * 6;
      notes.push(r.nom + ' → ' + vuX.toFixed(2) + ' / ' + vuY.toFixed(2)
        + ' px/pas (vrai ' + r.vx + ' / ' + r.vy + ') ≈ ' + kmh.toFixed(0) + ' km/h');
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
