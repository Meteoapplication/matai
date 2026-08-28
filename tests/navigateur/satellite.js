/**
 * Mata'i — LA PAGE SATELLITE, ET LA SÉPARATION QUI COMPTE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CET ESSAI EXISTE À PART DES AUTRES
 *
 * La page CIEL affiche deux choses qui se ressemblent comme deux gouttes
 * d'eau et qui n'ont pas la même valeur :
 *
 *   — douze photographies prises par GOES-18 ;
 *   — six images que NOUS fabriquons en prolongeant le mouvement mesuré.
 *
 * Les secondes ressemblent à des images satellite. Ce n'en sont pas.
 * Personne n'a photographié ce ciel-là.
 *
 * Si un pêcheur prend une image calculée pour une photo du ciel et sort en
 * conséquence, ça ne se rattrape pas. C'est la faute la plus grave que
 * cette application puisse commettre, et elle est silencieuse : rien à
 * l'écran ne clignote, aucun test unitaire ne la voit, elle ne se
 * découvre qu'en mer.
 *
 * Cet essai sert les deux jeux d'images à l'application réelle et vérifie,
 * une par une, les barrières qui les séparent.
 *
 * ⚠️  Comme ses voisins, il ne tourne pas dans « npm test ». Voir LISEZ-MOI.md.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { lancer } = require('./pw');

const URL = process.env.MATAI_URL || 'http://localhost:8099/';
const PAQUETS = process.env.MATAI_PAQUETS || path.resolve(__dirname, '..', '..', 'paquets');

const DU_BAC_A_SABLE = /404|ERR_TUNNEL|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|favicon/i;

/** Un JPEG minuscule et valide, teinté, fabriqué à la volée. */
async function vignette(sharp, teinte) {
  return sharp({
    create: { width: 120, height: 100, channels: 3, background: teinte }
  }).jpeg().toBuffer();
}

(async () => {
  let sharp;
  try {
    sharp = require(path.resolve(__dirname, '..', '..', 'node_modules', 'sharp'));
  } catch (e) {
    try { sharp = require('sharp'); } catch (e2) {
      console.error('sharp est nécessaire pour fabriquer les images d’essai.');
      process.exit(2);
    }
  }

  const source = path.join(PAQUETS, 'bora-bora.json');
  if (!fs.existsSync(source)) {
    console.error('Aucun paquet — lancer « npm run demo » d’abord.');
    process.exit(2);
  }
  const paquet = JSON.parse(fs.readFileSync(source, 'utf8'));

  // ── Les deux jeux d'images.
  //
  // On les teinte différemment : ce n'est pas de la décoration, c'est ce
  // qui permet de vérifier PAR LE PIXEL quelle image est affichée à quel
  // moment. Une observation grise, une projection orangée.
  const OBSERVEES = [];
  for (let k = 0; k < 12; k++) {
    const h = String(12 + Math.floor(k / 6)).padStart(2, '0');
    const m = String((k * 10) % 60).padStart(2, '0');
    OBSERVEES.push({ nom: '2026240' + h + m + '.jpg', buf: await vignette(sharp, { r: 90, g: 96, b: 100 }) });
  }
  const PROJETEES = [];
  for (let k = 1; k <= 6; k++) {
    const t = 12 * 10 + k * 10;
    const h = String(14 + Math.floor(t / 60) - 2).padStart(2, '0');
    const m = String(t % 60).padStart(2, '0');
    PROJETEES.push({
      nom: '2026240' + h + m + '.jpg',
      minutes: k * 10,
      buf: await vignette(sharp, { r: 200, g: 120, b: 60 })
    });
  }

  const indexAnim = { version: 1, images: OBSERVEES.map((x) => x.nom) };
  const indexProj = {
    version: 1,
    nature: 'projection',
    avertissement: 'Images calculées par extrapolation du déplacement observé.',
    dernierObserve: OBSERVEES[OBSERVEES.length - 1].nom.replace('.jpg', ''),
    cadence: 10,
    mouvement: { dxPixels: 2, dyPixels: -1, dispersion: 0, surImages: 5 },
    images: PROJETEES.map((x) => ({ fichier: x.nom, minutes: x.minutes }))
  };

  const nav = await lancer();
  const soucis = [];

  /**
   * Un passage complet sur la page CIEL.
   *
   * @param nom          libellé de l'essai
   * @param avecProjection sert-on l'index de projection ?
   * @param abimer       transformation de l'index de projection (pour les pièges)
   */
  async function passage(nom, avecProjection, abimer, emprise) {
    const page = await nav.newPage({ viewport: { width: 400, height: 1000 } });
    await page.clock.install({ time: new Date(Date.parse('2026-03-20T09:00:00Z') + 10 * 3600000) });

    page.on('pageerror', (e) => soucis.push(nom + ' — erreur JS : ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !DU_BAC_A_SABLE.test(m.text())) {
        soucis.push(nom + ' — console : ' + m.text());
      }
    });

    const servis = { anim: 0, proj: 0, imgObs: 0, imgProj: 0 };

    await page.route('**/paquets/**', async (route) => {
      const u = route.request().url();
      const f = decodeURIComponent(u.split('?')[0].split('/').pop());

      if (u.includes('/nuages/anim/index.json')) {
        servis.anim++;
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(indexAnim) });
      }
      if (u.includes('/nuages/projection/index.json')) {
        if (!avecProjection) return route.fulfill({ status: 404, body: 'absent' });
        servis.proj++;
        const idx = abimer ? abimer(JSON.parse(JSON.stringify(indexProj))) : indexProj;
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(idx) });
      }
      if (u.includes('/nuages/anim/')) {
        const im = OBSERVEES.find((x) => x.nom === f);
        if (im) { servis.imgObs++; return route.fulfill({ status: 200, contentType: 'image/jpeg', body: im.buf }); }
      }
      if (u.includes('/nuages/projection/')) {
        const im = PROJETEES.find((x) => x.nom === f);
        if (im) { servis.imgProj++; return route.fulfill({ status: 200, contentType: 'image/jpeg', body: im.buf }); }
      }
      if (f === 'bora-bora.json' || f === 'manifeste.json') {
        const sur = path.join(PAQUETS, f);
        if (!fs.existsSync(sur)) return route.fulfill({ status: 404, body: 'absent' });
        const corps = JSON.parse(fs.readFileSync(sur, 'utf8'));
        // L'emprise satellite n'existe pas dans un paquet de démonstration
        // (les nuages sont sautés). On l'injecte quand l'essai la demande :
        // c'est la seule façon d'exercer le repère de position.
        if (emprise && f === 'bora-bora.json') corps.cielRegional = emprise;
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(corps) });
      }
      return route.fulfill({ status: 404, body: 'absent' });
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);
    await page.locator('text=Plus de détail').first().click();
    await page.waitForTimeout(1200);
    await page.locator('[role="tab"][aria-label="CIEL"]').first().click();
    await page.waitForTimeout(2200);

    const texte = await page.evaluate(() => document.body.innerText);
    const resultat = { nom, texte, servis, page };
    return resultat;
  }

  /** Combien de crans la frise porte-t-elle, et de quelle nature ? */
  async function crans(page) {
    return page.evaluate(() =>
      [...document.querySelectorAll('[role="button"]')]
        .map((e) => e.getAttribute('aria-label'))
        .filter((l) => l && /^(observation|projection) /.test(l))
        .map((l) => l.split(' ')[0]));
  }

  // ═══════════════════════ 1. avec projection ═══════════════════════
  console.log('\n══ avec projection ══');
  {
    const r = await passage('avec projection', true, null);
    const nature = await crans(r.page);
    const obs = nature.filter((x) => x === 'observation').length;
    const proj = nature.filter((x) => x === 'projection').length;
    console.log('  frise : ' + obs + ' observations, ' + proj + ' projections');

    if (obs !== 12) soucis.push('avec projection : ' + obs + ' observations dans la frise au lieu de 12');
    if (proj !== 6) soucis.push('avec projection : ' + proj + ' projections dans la frise au lieu de 6');

    // ⚠️  Le compte annoncé sous la frise doit correspondre AUX CRANS.
    if (!/12 images observées/.test(r.texte)) {
      soucis.push('avec projection : la légende n’annonce pas 12 images observées');
    }
    if (!/6 projetées/.test(r.texte)) {
      soucis.push('avec projection : la légende n’annonce pas 6 images projetées');
    }

    // ── La barrière qui compte : en s'arrêtant sur un cran de projection,
    // l'écran doit le DIRE. Sans ça, les trois autres barrières ne servent
    // à rien : c'est celle-ci que l'utilisateur lit.
    const cransBoutons = await r.page.locator('[role="button"]').all();
    let clique = false;
    for (const b of cransBoutons) {
      const l = await b.getAttribute('aria-label');
      if (l && l.startsWith('projection ')) { await b.click(); clique = true; break; }
    }
    if (!clique) {
      soucis.push('avec projection : aucun cran de projection cliquable');
    } else {
      await r.page.waitForTimeout(700);
      const t2 = await r.page.evaluate(() => document.body.innerText);
      if (!/PROJECTION/.test(t2)) {
        soucis.push('avec projection : arrêté sur une image projetée, l’écran ne dit pas PROJECTION');
      }
      if (/MESURE/.test(t2.split('PROJECTION')[0] || '')) {
        // rien : on vérifie juste que PROJECTION est bien présent
      }
      console.log('  arrêt sur un cran projeté → l’écran dit : '
        + (/PROJECTION/.test(t2) ? 'PROJECTION ✓' : 'RIEN ✗'));

      // ── L'image affichée doit être la projetée (teinte orangée).
      const teinte = await r.page.evaluate(() => {
        const im = document.querySelector('img');
        return im ? im.getAttribute('src') : null;
      });
      if (teinte && !/projection/.test(teinte)) {
        soucis.push('avec projection : le cran projeté affiche une image du dossier des observations');
      }
      console.log('  image affichée : ' + (teinte ? teinte.split('/nuages/')[1] : '—'));
    }

    // ── Lecture et pause.
    //
    // ⚠️  L'ORDRE COMPTE, ET C'EST L'APPLICATION QUI A RAISON.
    //
    // Premier jet de cet essai : cliquer un cran, puis chercher « Pause ».
    // Il ne trouvait rien, et j'ai cru à un bouton manquant. C'est le
    // contraire : choisir un cran à la main met DÉJÀ en pause — c'est ce
    // qu'on veut, on s'arrête sur l'image qu'on regarde — donc le bouton
    // affiche « Lire ». Un essai qui se trompe d'ordre accuse le code.
    //
    // On vérifie donc les deux sens : « Lire » relance, « Pause » arrête.
    const image = () => r.page.evaluate(() => (document.querySelector('img') || {}).src);

    const lire = r.page.locator('text=Lire').first();
    if (!(await lire.count())) {
      soucis.push('après avoir choisi un cran, le bouton ne propose pas de relancer');
    } else {
      await lire.click();
      const a1 = await image();
      await r.page.waitForTimeout(1600);
      const a2 = await image();
      if (a1 === a2) soucis.push('« Lire » ne relance pas le défilement');
      console.log('  lecture : ' + (a1 !== a2 ? 'l’image avance ✓' : 'l’image reste ✗'));

      const pause = r.page.locator('text=Pause').first();
      if (!(await pause.count())) {
        soucis.push('aucun bouton de pause une fois l’animation lancée');
      } else {
        await pause.click();
        await r.page.waitForTimeout(300);
        const b1 = await image();
        await r.page.waitForTimeout(1600);
        const b2 = await image();
        if (b1 !== b2) soucis.push('la pause n’arrête pas le défilement');
        console.log('  pause   : ' + (b1 === b2 ? 'l’image reste ✓' : 'l’image change ✗'));
      }
    }

    // ── Le zoom doit agrandir l'image.
    const av = await r.page.evaluate(() => {
      const im = document.querySelector('img');
      return im ? im.getBoundingClientRect().width : 0;
    });
    const z3 = r.page.locator('text=×3').first();
    if (await z3.count()) {
      await z3.click();
      await r.page.waitForTimeout(500);
      const ap = await r.page.evaluate(() => {
        const im = document.querySelector('img');
        return im ? im.getBoundingClientRect().width : 0;
      });
      if (!(ap > av * 2)) soucis.push('le zoom ×3 n’agrandit pas l’image (' + av + ' → ' + ap + ')');
      console.log('  zoom ×3 : ' + Math.round(av) + ' px → ' + Math.round(ap) + ' px');
    } else {
      soucis.push('aucun bouton de zoom trouvé');
    }

    await r.page.screenshot({ path: '/tmp/satellite-projection.png' });
    await r.page.close();
  }

  // ═══════════════════════ 2. sans projection ═══════════════════════
  console.log('\n══ sans projection (le backend a refusé) ══');
  {
    const r = await passage('sans projection', false, null);
    const nature = await crans(r.page);
    const proj = nature.filter((x) => x === 'projection').length;
    console.log('  frise : ' + nature.length + ' crans, dont ' + proj + ' projections');
    if (proj !== 0) soucis.push('sans projection : ' + proj + ' crans de projection alors qu’il n’y en a pas');
    if (!/Pas de projection en ce moment/.test(r.texte)) {
      soucis.push('sans projection : l’écran ne dit pas qu’il n’y en a pas');
    }
    await r.page.close();
  }

  // ═══════════════ 3. LE PIÈGE : un index qui ment ═══════════════
  //
  // ⚠️  On sert, à l'adresse de la projection, un index qui ne se déclare
  // PAS comme une projection — exactement ce qui arriverait si un chemin
  // était inversé côté serveur et que l'index de l'animation atterrissait
  // là. L'application doit le REFUSER, pas l'afficher.
  console.log('\n══ piège : index de projection non déclaré ══');
  {
    const r = await passage('index menteur', true, (idx) => { delete idx.nature; return idx; });
    const nature = await crans(r.page);
    const proj = nature.filter((x) => x === 'projection').length;
    console.log('  frise : ' + nature.length + ' crans, dont ' + proj + ' projections');
    if (proj !== 0) {
      soucis.push('PIÈGE : un index sans champ « nature » a été affiché comme une projection');
    }
    await r.page.close();
  }

  // ═══════ 3 bis. LE PIÈGE : une projection PÉRIMÉE ═══════
  //
  // ⚠️  Les deux index sont chargés et mis en cache séparément. Sur un
  // atoll, une requête sur deux passe : on peut donc avoir en main une
  // boucle fraîche et une projection restée en cache, calculée une heure
  // plus tôt. Recollée derrière les images récentes, elle s'afficherait
  // « dans 10 minutes » alors qu'elle décrit une heure déjà passée.
  //
  // Le backend publie `dernierObserve` — l'image réelle sur laquelle la
  // projection a été bâtie. Si elle ne correspond pas à la dernière image
  // de la boucle, l'application doit REFUSER de l'afficher.
  console.log('\n══ piège : projection calculée sur des images anciennes ══');
  {
    const r = await passage('projection périmée', true,
      (idx) => { idx.dernierObserve = '20262400900'; return idx; });
    const nature = await crans(r.page);
    const proj = nature.filter((x) => x === 'projection').length;
    console.log('  frise : ' + nature.length + ' crans, dont ' + proj + ' projections');
    if (proj !== 0) {
      soucis.push('PIÈGE : une projection calculée sur des images plus anciennes '
        + 'que la boucle a été affichée comme si elle décrivait l’heure qui vient');
    }
    const t = await r.page.evaluate(() => document.body.innerText);
    if (!/plus anciennes/.test(t)) {
      soucis.push('projection périmée : l’écran ne dit pas pourquoi elle n’apparaît pas');
    }
    await r.page.close();
  }

  // ═══════════ 4. LE REPÈRE DE POSITION ═══════════
  //
  // ⚠️  Il ne s'affiche que si le backend publie l'emprise satellite ET la
  // position de l'île dedans (`x`, `y`, en fraction de 0 à 1). Aucun paquet
  // de démonstration ne les porte — les nuages sont sautés en mode démo —
  // donc ce chemin restait écrit et jamais parcouru. On les injecte.
  //
  // Un point posé au jugé sur une image satellite serait une information
  // fausse sur l'écran dont les gens se servent pour voir d'où vient un
  // grain. D'où les deux essais : présent quand on sait, ABSENT quand on
  // ne sait pas.
  console.log('\n══ repère de position ══');
  {
    const EMPRISE = {
      fichier: 'nuages/polynesie.jpg', largeur: 1200, hauteur: 1000,
      origine: { col: 100, lig: 100 }, disque: 5424,
      x: 0.25, y: 0.60
    };
    const r = await passage('repère', true, null, EMPRISE);
    const pos = await r.page.evaluate(() => {
      const e = document.querySelector('[data-testid="repere-position"]');
      if (!e) return null;
      const b = e.getBoundingClientRect();
      const cadre = e.closest('div').parentElement.getBoundingClientRect();
      return { x: b.left + b.width / 2 - cadre.left, y: b.top + b.height / 2 - cadre.top,
               l: cadre.width, h: cadre.height };
    });

    if (!pos) {
      soucis.push('repère : l’emprise et la position sont publiées, et rien n’est dessiné');
      console.log('  repère : ABSENT ✗');
    } else {
      const fx = pos.x / pos.l, fy = pos.y / pos.h;
      console.log('  repère à ' + fx.toFixed(3) + ' / ' + fy.toFixed(3)
        + '  (attendu ' + EMPRISE.x + ' / ' + EMPRISE.y + ')');
      // Deux pour cent de tolérance : le repère est centré au pixel près,
      // pas au sous-pixel.
      if (Math.abs(fx - EMPRISE.x) > 0.02 || Math.abs(fy - EMPRISE.y) > 0.02) {
        soucis.push('repère : posé à ' + fx.toFixed(3) + '/' + fy.toFixed(3)
          + ' au lieu de ' + EMPRISE.x + '/' + EMPRISE.y);
      }
    }
    await r.page.screenshot({ path: '/tmp/satellite-repere.png' });
    await r.page.close();
  }

  // ── Et sans position publiée, AUCUN repère.
  {
    const sansPosition = {
      fichier: 'nuages/polynesie.jpg', largeur: 1200, hauteur: 1000,
      origine: { col: 100, lig: 100 }, disque: 5424
      // pas de x, pas de y : l'île n'est pas dans l'emprise
    };
    const r = await passage('sans position', true, null, sansPosition);
    const present = await r.page.evaluate(() =>
      !!document.querySelector('[data-testid="repere-position"]'));
    console.log('  sans position publiée → repère ' + (present ? 'DESSINÉ ✗' : 'absent ✓'));
    if (present) {
      soucis.push('un repère a été dessiné alors que la position de l’île n’est pas connue '
        + '— un point posé au jugé sur une image satellite');
    }
    await r.page.close();
  }

  console.log('\n' + (soucis.length
    ? '✗ ' + soucis.length + ' souci(s) :\n  ' + soucis.join('\n  ')
    : '✓ observé et projeté ne se mélangent pas'));

  await nav.close();
  process.exit(soucis.length ? 1 : 0);
})();
