/**
 * Mesurer sur l'infrarouge, afficher le visible — et retomber proprement.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI DEUX CANAUX.
 *
 * GEOCOLOR est la composition destinée à l'œil. On a longtemps écrit dans
 * `nuages.mjs` qu'elle « bascule en infrarouge la nuit, c'est la seule qui
 * reste lisible 24 h sur 24 ». C'est faux au-dessus du Pacifique : ce
 * rendu de nuit s'appuie sur les lumières des villes et un voile éclairé
 * par la lune, et il n'y a ni l'un ni l'autre. Mesuré sur le recadrage
 * régional réellement publié, au crépuscule du 28 août 2026 :
 *
 *     heure locale   GEOCOLOR   bande 13 (infrarouge)
 *      16 h 10          90,9          110,0
 *      17 h 30          24,0          111,0
 *      18 h 50          17,8          110,3
 *
 * Le visible s'éteint, l'infrarouge ne bouge pas d'un demi pour cent.
 * L'infrarouge voit la CHALEUR des sommets de nuages : il ignore le
 * soleil, donc il ignore le terminateur — cette frontière jour/nuit qui
 * balaie le Pacifique à 1 600 km/h et que la corrélation suivait au lieu
 * des nuages.
 *
 * ⚠️  CE QUE CET ESSAI PROTÈGE VRAIMENT : LE REPLI.
 *
 * L'infrarouge peut manquer — première mise en service, créneau sauté par
 * le satellite, budget de temps épuisé au milieu d'un passage. Le code
 * retombe alors sur le visible. Ce repli est exactement le genre de chemin
 * qu'on écrit une fois et qu'on n'exécute jamais en développement, parce
 * qu'en développement les deux dossiers sont toujours pleins.
 *
 * Et il a une deuxième façon de casser, plus vicieuse : si le repli ne se
 * déclenche PAS alors qu'il manque une seule image infrarouge, `sharp`
 * reçoit un fichier absent, la projection est abandonnée, et `build.mjs`
 * avale l'erreur — le passage reste vert et la fonctionnalité disparaît
 * sans bruit. C'est précisément comme ça que le point 6 du cahier des
 * charges n'a jamais été publié pendant toute son existence.
 * ═══════════════════════════════════════════════════════════════════════
 */

const path = require('path');

module.exports = async function () {
  let sharp;
  try { sharp = require('sharp'); } catch (e) { return { saute: 'sharp absent' }; }

  const os = require('os');
  const { writeFile, mkdtemp, mkdir, rm } = require('fs/promises');

  const N = await import('file://' + path.resolve(__dirname, '..', 'nuages.mjs'));
  const P = await import('file://' + path.resolve(__dirname, '..', 'projection.mjs'));

  const fautes = [];
  const notes = [];

  // ── les adresses des deux bandes
  if (typeof N.urlBande !== 'function') {
    fautes.push('nuages.mjs n’expose plus « urlBande » : le canal de mesure '
      + 'n’est plus atteignable');
    return { notes, fautes };
  }

  const H = '20262400300';
  const vis = N.urlBande(H, N.BANDE_VISIBLE);
  const ir = N.urlBande(H, N.BANDE_INFRAROUGE);

  // Les formes relevées sur le CDN de la NOAA le 28 août 2026.
  if (!/\/GEOCOLOR\/20262400300_GOES18-ABI-FD-GEOCOLOR-5424x5424\.jpg$/.test(vis)) {
    fautes.push('l’adresse du visible a changé de forme : « ' + vis + ' »');
  }
  if (!/\/13\/20262400300_GOES18-ABI-FD-13-1808x1808\.jpg$/.test(ir)) {
    fautes.push('l’adresse de l’infrarouge a changé de forme : « ' + ir + ' » — '
      + 'relevé sur le CDN : …/FD/13/AAAAJJJHHMM_GOES18-ABI-FD-13-1808x1808.jpg');
  }
  if (vis === ir) {
    fautes.push('les deux bandes rendent la même adresse : on mesurerait sur '
      + 'l’image qu’on affiche, et le terminateur reviendrait');
  }
  notes.push('visible en 5424, infrarouge en 1808 — 6 km le pixel, assez pour '
    + 'un alizé qui parcourt 20 km en quarante minutes');

  // ── l'emprise doit être la MÊME dans les deux tailles
  //
  // Si les deux recadrages ne couvraient pas la même portion de globe, le
  // déplacement mesuré sur l'un ne s'appliquerait pas à l'autre : on
  // décalerait l'image visible d'une quantité mesurée ailleurs.
  const e5424 = N.empriseRegion(5424);
  const e1808 = N.empriseRegion(1808);
  const rapport = (a, b) => Math.abs(a / b - 3) < 0.06;   // 5424 / 1808 = 3
  if (!rapport(e5424.largeur, e1808.largeur) || !rapport(e5424.hauteur, e1808.hauteur)) {
    fautes.push('les deux recadrages ne couvrent pas la même zone : '
      + e5424.largeur + '×' + e5424.hauteur + ' contre '
      + e1808.largeur + '×' + e1808.hauteur + ' — le déplacement mesuré sur '
      + 'l’infrarouge ne vaudrait pas pour l’image affichée');
  } else {
    notes.push('même emprise dans les deux tailles : ' + e1808.largeur + '×'
      + e1808.hauteur + ' à 1808, ' + e5424.largeur + '×' + e5424.hauteur + ' à 5424');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── LE REPLI, ÉPROUVÉ POUR DE VRAI
  //
  // On fabrique un paquet complet : douze images visibles qui défilent, et
  // un dossier infrarouge que l'on remplit ou non. Dans les deux cas la
  // projection doit rendre un résultat — jamais planter, jamais disparaître.
  // ═════════════════════════════════════════════════════════════════════
  const L = 412, Ht = 357;

  function champ(n, graine) {
    let s = graine;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    return Array.from({ length: n }, () => ({
      x: rnd() * L, y: rnd() * Ht, r: 14 + rnd() * 46, a: 0.45 + rnd() * 0.55
    }));
  }
  function rendre(amas, dx, dy) {
    const px = Buffer.alloc(L * Ht, 28);
    for (const c of amas) {
      const cx = c.x + dx, cy = c.y + dy, r2 = c.r * c.r;
      const x0 = Math.max(0, Math.floor(cx - c.r)), x1 = Math.min(L, Math.ceil(cx + c.r));
      const y0 = Math.max(0, Math.floor(cy - c.r)), y1 = Math.min(Ht, Math.ceil(cy + c.r));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > r2) continue;
        const i = y * L + x;
        px[i] = Math.min(255, px[i] + Math.exp(-d2 / (r2 * 0.35)) * 220 * c.a);
      }
    }
    return sharp(px, { raw: { width: L, height: Ht, channels: 1 } })
      .jpeg({ quality: 76 }).toBuffer();
  }

  const racine = await mkdtemp(path.join(os.tmpdir(), 'matai-ir-'));
  try {
    for (const avecIr of [true, false]) {
      const sortie = path.join(racine, avecIr ? 'avec' : 'sans');
      const anim = path.join(sortie, 'nuages', 'anim');
      const animIr = path.join(sortie, 'nuages', 'anim-ir');
      await mkdir(anim, { recursive: true });
      await mkdir(animIr, { recursive: true });

      const amas = champ(70, 5);
      const images = [];
      for (let k = 0; k < 12; k++) {
        const nom = '2026240' + String(100 + k * 10).padStart(4, '0') + '.jpg';
        // Le visible bouge d'un vecteur, l'infrarouge du MÊME : c'est le
        // même ciel vu autrement.
        await writeFile(path.join(anim, nom), await rendre(amas, k * 2.2, k * 0.8));
        if (avecIr) {
          await writeFile(path.join(animIr, nom), await rendre(amas, k * 2.2, k * 0.8));
        }
        images.push({ fichier: 'nuages/anim/' + nom });
      }
      await writeFile(path.join(anim, 'index.json'), JSON.stringify({ images }));

      let r;
      try {
        r = await P.produireProjection(sortie);
      } catch (e) {
        fautes.push((avecIr ? 'avec' : 'sans') + ' infrarouge : la projection a '
          + 'PLANTÉ — ' + e.message + '. build.mjs avalerait l’erreur et le '
          + 'passage resterait vert avec la fonctionnalité disparue');
        continue;
      }

      const attendu = avecIr ? 'infrarouge' : 'visible';
      if (r.canal !== attendu && (!r.mouvement || r.mouvement.canal !== attendu)) {
        const vu = r.canal || (r.mouvement && r.mouvement.canal) || '(non dit)';
        fautes.push((avecIr ? 'avec' : 'sans') + ' infrarouge : la mesure dit '
          + '« ' + vu +' » au lieu de « ' + attendu + ' »'
          + (avecIr ? '' : ' — le repli ne s’est pas déclenché, sharp recevra '
            + 'un fichier absent au prochain créneau manquant'));
      } else {
        notes.push((avecIr ? 'infrarouge présent' : 'infrarouge absent')
          + ' → mesure sur ' + attendu
          + (r.erreur ? ' · refus : ' + String(r.erreur).slice(0, 46) : ' · projection publiée'));
      }
    }

    // ── et il suffit d'UNE image manquante pour basculer
    //
    // Le repli ne doit pas exiger que le dossier soit vide : douze images
    // moins une, et la mesure ne peut plus se faire sur ce canal.
    {
      const sortie = path.join(racine, 'trouee');
      const anim = path.join(sortie, 'nuages', 'anim');
      const animIr = path.join(sortie, 'nuages', 'anim-ir');
      await mkdir(anim, { recursive: true });
      await mkdir(animIr, { recursive: true });
      const amas = champ(70, 5);
      const images = [];
      for (let k = 0; k < 12; k++) {
        const nom = '2026240' + String(100 + k * 10).padStart(4, '0') + '.jpg';
        const img = await rendre(amas, k * 2.2, k * 0.8);
        await writeFile(path.join(anim, nom), img);
        if (k !== 7) await writeFile(path.join(animIr, nom), img);   // une trouée
        images.push({ fichier: 'nuages/anim/' + nom });
      }
      await writeFile(path.join(anim, 'index.json'), JSON.stringify({ images }));

      let r;
      try {
        r = await P.produireProjection(sortie);
      } catch (e) {
        fautes.push('une seule image infrarouge manquante fait PLANTER la '
          + 'projection — ' + e.message);
        r = null;
      }
      if (r) {
        const canal = r.canal || (r.mouvement && r.mouvement.canal);
        if (canal !== 'visible') {
          fautes.push('avec UNE image infrarouge manquante sur douze, la mesure '
            + 'dit « ' + canal + ' » : elle va lire un fichier qui n’existe pas');
        } else {
          notes.push('une seule image infrarouge manquante suffit à revenir au visible');
        }
      }
    }
  } finally {
    await rm(racine, { recursive: true, force: true }).catch(() => {});
  }

  return { notes, fautes };
};
