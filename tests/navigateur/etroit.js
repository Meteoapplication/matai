/**
 * Mata'i — les petits écrans.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 *
 * La barre d'onglets réclamait quatre fois 78 pixels, plus douze de marge de
 * chaque côté : 336 px. Sur un téléphone de 320 — un appareil d'entrée de
 * gamme, c'est-à-dire exactement le public visé — la barre dépassait. La page
 * entière se laissait tirer de quatre pixels sur le côté et le dernier onglet
 * sortait du cadre.
 *
 * Ce défaut est invisible partout où on regarde d'habitude :
 *
 *   — invisible sur un écran de développeur, qui fait 1 400 px de large ;
 *   — invisible au banc d'essai, qui ne dessine rien ;
 *   — invisible sur une copie d'écran, parce que la copie est prise à la
 *     largeur du cadre : ce qui dépasse n'y figure pas.
 *
 * Il n'apparaît qu'en mesurant `scrollWidth` contre `clientWidth`. C'est ce
 * que fait ce fichier, sur quatre largeurs et quatre écrans.
 *
 * 320 px n'est pas une hypothèse : c'est le plancher Android, et la Polynésie
 * n'achète pas que des téléphones neufs.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  CE QU'IL NE REGARDE PAS : L'AGRANDISSEMENT DE POLICE.
 *
 * Ce fichier fait varier la LARGEUR de l'écran, et rien d'autre. Le
 * navigateur tourne toujours à taille de police normale.
 *
 * Le 29 août 2026, sur un vrai téléphone, « MESURES » s'est coupé en
 * « MESURE » / « S », le S venant chevaucher « ACCUEIL » — sur toutes les
 * pages, en permanence. Ce fichier n'a rien vu, et ne POUVAIT rien voir :
 * la cause était le réglage d'accessibilité du système, qui multiplie
 * toutes les tailles de texte par 1,15, 1,3, parfois 2.
 *
 * Le pire n'est pas qu'il soit passé à côté. C'est qu'il donnait
 * l'impression que la barre d'onglets était éprouvée. Un essai qui couvre
 * un axe et laisse croire qu'il les couvre tous est plus dangereux que pas
 * d'essai du tout.
 *
 * Cet axe-là est désormais mesuré par `tests/29-barre-onglets.js`, qui
 * calcule la largeur du texte à partir des largeurs réelles des lettres.
 * Si un jour ce fichier-ci sait piloter la taille de police du navigateur,
 * les deux pourront fusionner.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️  Comme ses voisins, il ne tourne pas dans « npm test ». Voir LISEZ-MOI.md.
 */

const { lancer } = require('./pw');

const URL = process.env.MATAI_URL || 'http://localhost:8099/';

/** 320 : le plancher Android. 412 : un grand téléphone courant. */
const LARGEURS = [320, 360, 400, 412];

/**
 * Les onglets de la barre du bas.
 *
 * ⚠️  ACCUEIL est volontairement absent : il renvoie en mode simple et
 * démonte la barre sous les pieds de la boucle. PRO aussi : ce n'est plus
 * un onglet mais une bascule en haut de SORTIE.
 */
const ONGLETS = ['MESURES', '5 JOURS', 'CIEL', 'ASTRES', 'SORTIE'];

(async () => {
  const nav = await lancer();
  const soucis = [];

  for (const L of LARGEURS) {
    const page = await nav.newPage({ viewport: { width: L, height: 720 } });
    await page.clock.install({ time: new Date(Date.parse('2026-03-20T09:00:00Z') + 10 * 3600000) });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    async function verifier(ecran) {
      const r = await page.evaluate(() => {
        const out = { deborde: 0, coupes: [], pageLarge: 0 };

        // ⚠️  LA MESURE QUI COMPTE. Le corps de la page ne doit JAMAIS
        // pouvoir défiler horizontalement : une app qui se laisse tirer de
        // côté donne l'impression d'être cassée, et sur un bateau on la tire
        // sans le vouloir.
        out.pageLarge = document.documentElement.scrollWidth
                      - document.documentElement.clientWidth;

        for (const el of document.querySelectorAll('*')) {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') continue;

          // ⚠️  ON SAUTE TOUT CE QUI EST DANS UN SVG.
          //
          // `clientWidth` et `scrollWidth` sont des notions de mise en page
          // HTML : sur un élément SVG elles renvoient des valeurs qui ne
          // décrivent rien. La lettre « O » de la rose des vents était
          // signalée comme un débordement à chaque passage (clientWidth 8,
          // scrollWidth 10) alors qu'elle se dessine parfaitement et que la
          // page, elle, ne défile pas d'un pixel. Un garde-fou qui crie
          // pour rien apprend à ne plus l'écouter.
          if (el.ownerSVGElement || el.tagName.toLowerCase() === 'svg') continue;

          // Un conteneur qui déborde sans être prévu pour défiler.
          // Les bandes horizontales voulues (le choix des points de mesure)
          // sont en overflowX auto/scroll : elles ne comptent pas.
          if (el.scrollWidth > el.clientWidth + 1
              && st.overflowX !== 'auto' && st.overflowX !== 'scroll') {
            out.deborde++;
          }

          // Une feuille de texte plus large que la place qu'elle a.
          const t = (el.textContent || '').trim();
          if (t && el.children.length === 0
              && el.scrollWidth > el.clientWidth + 1 && t.length > 3) {
            out.coupes.push(t.slice(0, 60));
          }
        }
        return out;
      });

      if (r.pageLarge > 1) {
        soucis.push(L + 'px / ' + ecran + ' : la page déborde de '
          + r.pageLarge + ' px en largeur');
      }
      for (const c of [...new Set(r.coupes)].slice(0, 6)) {
        soucis.push(L + 'px / ' + ecran + ' : texte coupé — « ' + c + ' »');
      }
      console.log('  ' + ecran.padEnd(8) + ' débordements ' + r.deborde
        + ', textes coupés ' + new Set(r.coupes).size
        + ', page +' + r.pageLarge + 'px');
    }

    console.log('\n══ ' + L + ' px ══');
    await verifier('accueil');
    await page.locator('text=Plus de détail').first().click();
    await page.waitForTimeout(1200);
    for (const o of ONGLETS) {
      await page.locator('[role="tab"][aria-label="' + o + '"]').first().click();
      await page.waitForTimeout(1100);
      await verifier(o);
    }
    await page.close();
  }

  console.log('\n' + (soucis.length
    ? '✗ ' + soucis.length + ' souci(s) :\n  ' + soucis.join('\n  ')
    : '✓ rien à signaler sur ' + LARGEURS.length + ' largeurs × 4 écrans'));

  await nav.close();
  process.exit(soucis.length ? 1 : 0);
})();
