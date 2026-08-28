/**
 * La mesure par île, éprouvée contre un ciel qu'on a fabriqué exprès.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER DÉMONTRE.
 *
 * `projection.mjs` mesure UN déplacement pour toute la Polynésie. On a
 * montré (tests/20-mouvement.js) que ce modèle ne tient pas : sur les
 * vraies images du 28 août, les seize tuiles de la région s'écartaient de
 * trente-six kilomètres.
 *
 * `parile.mjs` fait le même calcul dans une fenêtre de mille kilomètres
 * autour de chaque île. Cet essai fabrique un ciel qui se déchire — la
 * moitié gauche part vers l'ouest, la moitié droite vers l'est — et
 * vérifie les deux choses qui comptent :
 *
 *   1. la mesure RÉGIONALE refuse, parce qu'aucune translation unique ne
 *      décrit ce ciel ;
 *   2. la mesure par ÎLE réussit des deux côtés, et trouve les deux
 *      directions opposées, chacune chez elle.
 *
 * C'est exactement la situation réelle : le ciel n'est pas incohérent, il
 * est simplement plus grand que ce qu'une seule flèche peut décrire.
 *
 * ⚠️  ET CE QU'IL PROTÈGE EN PLUS.
 *
 * Une île près du bord de l'emprise — les Marquises au nord, les Gambier au
 * sud-est — a une fenêtre qui dépasse du cadre. `fenetreIle` la ramène à
 * l'intérieur plutôt que de la rétrécir : une fenêtre plus petite
 * mesurerait sur moins de nuages et rendrait un chiffre moins sûr SANS LE
 * DIRE. Si quelqu'un « simplifie » ça un jour, deux archipels sur six
 * perdent leur mesure en silence.
 * ═══════════════════════════════════════════════════════════════════════
 */

const path = require('path');

/** Dimensions du recadrage régional infrarouge, relevées en production. */
const L = 412, H = 357, KM_PAR_PIXEL = 6;

module.exports = async function () {
  let sharp;
  try { sharp = require('sharp'); } catch (e) { return { saute: 'sharp absent' }; }

  const os = require('os');
  const { writeFile, mkdtemp, rm } = require('fs/promises');

  const PI = await import('file://' + path.resolve(__dirname, '..', 'parile.mjs'));
  const P = await import('file://' + path.resolve(__dirname, '..', 'projection.mjs'));

  const fautes = [];
  const notes = [];

  // ═════════════════════════════════════════════════════════════════════
  // ── la fenêtre : géométrie pure, sans image
  // ═════════════════════════════════════════════════════════════════════
  {
    const cote = Math.round(2 * PI.RAYON_KM / KM_PAR_PIXEL);   // 167 px
    const centre = PI.fenetreIle(L, H, 0.5, 0.5, KM_PAR_PIXEL);
    if (centre.cote !== Math.min(cote, L, H)) {
      fautes.push('fenêtre au centre : côté ' + centre.cote + ' au lieu de '
        + Math.min(cote, L, H));
    }

    // Une île collée au coin : la fenêtre doit RESTER entière, ramenée dans
    // le cadre — pas rétrécie.
    for (const [quoi, x, y] of [['coin haut-gauche', 0.02, 0.02],
                                ['coin bas-droit', 0.98, 0.98],
                                ['bord droit', 0.99, 0.5]]) {
      const f = PI.fenetreIle(L, H, x, y, KM_PAR_PIXEL);
      if (f.cote !== centre.cote) {
        fautes.push(quoi + ' : la fenêtre a été RÉTRÉCIE (' + f.cote + ' au lieu de '
          + centre.cote + ') — elle mesurerait sur moins de nuages sans le dire, '
          + 'et les Marquises comme les Gambier sont dans ce cas');
      }
      if (f.gauche < 0 || f.haut < 0 || f.gauche + f.cote > L || f.haut + f.cote > H) {
        fautes.push(quoi + ' : la fenêtre sort du cadre — '
          + JSON.stringify(f) + ' dans ' + L + '×' + H
          + ' — sharp refusera le découpage');
      }
    }
    notes.push('fenêtre de ' + centre.cote + ' px ≈ ' + (centre.cote * KM_PAR_PIXEL)
      + ' km, entière même dans les coins de l’emprise');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── un ciel qui se déchire : deux moitiés, deux directions
  // ═════════════════════════════════════════════════════════════════════
  function champ(n, graine, x0, x1) {
    let s = graine;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    return Array.from({ length: n }, () => ({
      x: x0 + rnd() * (x1 - x0), y: rnd() * H,
      r: 10 + rnd() * 26, a: 0.5 + rnd() * 0.5
    }));
  }
  function rendre(amas) {
    const px = Buffer.alloc(L * H, 26);
    for (const c of amas) {
      const r2 = c.r * c.r;
      const x0 = Math.max(0, Math.floor(c.x - c.r)), x1 = Math.min(L, Math.ceil(c.x + c.r));
      const y0 = Math.max(0, Math.floor(c.y - c.r)), y1 = Math.min(H, Math.ceil(c.y + c.r));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
        if (d2 > r2) continue;
        px[y * L + x] = Math.min(255, px[y * L + x] + Math.exp(-d2 / (r2 * 0.35)) * 225 * c.a);
      }
    }
    return sharp(px, { raw: { width: L, height: H, channels: 1 } })
      .jpeg({ quality: 80 }).toBuffer();
  }

  const dossier = await mkdtemp(path.join(os.tmpdir(), 'matai-ile-'));
  try {
    // Ouest : 1,6 px/pas vers la gauche. Est : 1,6 px/pas vers la droite.
    // À 6 km le pixel et 10 min le pas, cela fait 58 km/h de chaque côté,
    // en sens opposés.
    const gauche = champ(60, 3, 0, L * 0.5);
    const droite = champ(60, 11, L * 0.5, L);

    const chemins = [];
    for (let i = 0; i < 12; i++) {
      const amas = [
        ...gauche.map((c) => ({ ...c, x: c.x - i * 1.6 })),
        ...droite.map((c) => ({ ...c, x: c.x + i * 1.6 }))
      ];
      const f = path.join(dossier, 'd' + String(i).padStart(2, '0') + '.jpg');
      await writeFile(f, await rendre(amas));
      chemins.push(f);
    }

    // ── 1. la mesure régionale doit refuser
    const regional = await P.mesurerMouvement(sharp, chemins);
    if (!regional) {
      fautes.push('mesure régionale : aucun résultat sur 12 images');
    } else if (!regional.refus) {
      fautes.push('LA MESURE RÉGIONALE ACCEPTE un ciel qui part dans deux '
        + 'directions opposées : ' + regional.dx.toFixed(2) + ' / '
        + regional.dy.toFixed(2) + ' — une moitié de la région serait déplacée '
        + 'à l’envers');
    } else {
      notes.push('mesure régionale → refusée : ' + String(regional.refus).slice(0, 58));
    }

    // ── 2. la mesure par île doit réussir des DEUX côtés, en sens opposés
    const iles = [
      { id: 'ouest', nom: 'Île ouest', x: 0.22, y: 0.5 },
      { id: 'est',   nom: 'Île est',   x: 0.78, y: 0.5 }
    ];
    const m = await PI.mesurerToutesLesIles(sharp, chemins, iles,
      { largeur: L, hauteur: H, kmParPixel: KM_PAR_PIXEL, cadence: 10 });

    const parId = Object.fromEntries(m.map((x) => [x.id, x]));
    for (const id of ['ouest', 'est']) {
      if (parId[id].refus) {
        fautes.push('île « ' + id + ' » refusée (' + parId[id].refus + ') alors que '
          + 'son ciel se déplace franchement et d’un seul tenant dans sa fenêtre : '
          + 'c’est le cas où la projection par île doit justement marcher');
      }
    }

    if (!parId.ouest.refus && !parId.est.refus) {
      // L'ouest part à gauche (dx < 0), l'est à droite (dx > 0).
      if (!(parId.ouest.dxBase < 0)) {
        fautes.push('l’île ouest devrait partir vers l’ouest, elle rend dx = '
          + parId.ouest.dxBase);
      }
      if (!(parId.est.dxBase > 0)) {
        fautes.push('l’île est devrait partir vers l’est, elle rend dx = '
          + parId.est.dxBase);
      }
      // Et les caps doivent être franchement opposés.
      //
      // ⚠️  Premier jet : `Math.abs(((a - b + 540) % 360) - 180)`, qui rend
      // 180 quand les caps SONT opposés — l'essai échouait donc sur du code
      // juste, en annonçant « 270° et 90°, écart à l'opposé 180° ». Une
      // formule d'angle se vérifie sur un cas connu avant d'être crue.
      let diff = Math.abs(parId.ouest.cap - parId.est.cap) % 360;
      if (diff > 180) diff = 360 - diff;
      const ecart = Math.abs(diff - 180);   // 0 quand ils sont opposés
      if (ecart > 45) {
        fautes.push('les deux îles devraient avoir des caps opposés : '
          + parId.ouest.cap + '° et ' + parId.est.cap + '° — écart à l’opposé '
          + ecart.toFixed(0) + '°');
      } else {
        notes.push('ciel déchiré → ouest ' + parId.ouest.noeuds + ' nds vers '
          + parId.ouest.cap + '°, est ' + parId.est.noeuds + ' nds vers '
          + parId.est.cap + '° — deux caps opposés, chacun chez lui');
      }
    }

    // ── 3. et un ciel uniforme doit donner la MÊME réponse aux deux îles
    {
      const tout = champ(120, 7, 0, L);
      const ch2 = [];
      for (let i = 0; i < 12; i++) {
        const amas = tout.map((c) => ({ ...c, x: c.x - i * 1.6, y: c.y + i * 0.5 }));
        const f = path.join(dossier, 'u' + String(i).padStart(2, '0') + '.jpg');
        await writeFile(f, await rendre(amas));
        ch2.push(f);
      }
      const u = await PI.mesurerToutesLesIles(sharp, ch2, iles,
        { largeur: L, hauteur: H, kmParPixel: KM_PAR_PIXEL, cadence: 10 });
      const uo = u.find((x) => x.id === 'ouest'), ue = u.find((x) => x.id === 'est');
      if (uo.refus || ue.refus) {
        fautes.push('ciel uniforme : une île refuse (' + (uo.refus || ue.refus)
          + ') alors que tout se déplace ensemble — le garde-fou est trop serré');
      } else if (Math.abs(uo.cap - ue.cap) > 30) {
        fautes.push('ciel uniforme : les deux îles trouvent des caps différents ('
          + uo.cap + '° et ' + ue.cap + '°) alors que tout bouge ensemble');
      } else {
        notes.push('ciel uniforme → les deux îles s’accordent : ' + uo.cap + '° et '
          + ue.cap + '°, ' + uo.noeuds + ' et ' + ue.noeuds + ' nds');
      }
    }
  } finally {
    await rm(dossier, { recursive: true, force: true }).catch(() => {});
  }

  return { notes, fautes };
};
