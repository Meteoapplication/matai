/**
 * Mata'i — la même application, lue à sept heures différentes de la journée.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 *
 * Presque tous les défauts trouvés sur cette application étaient des défauts
 * d'HEURE :
 *
 *   — « Belle journée sur l'eau » affiché à 22 h 30 ;
 *   — l'heure de coucher du soleil de la veille ;
 *   — les températures extrêmes du mauvais jour ;
 *   — le soleil peint au milieu du ciel à 17 h ;
 *   — « Randonnée — de 7 h à 18 h le lendemain », trente-cinq heures ;
 *   — « Paddle — FAVORABLE » sans une seule heure à montrer.
 *
 * Et tous, sans exception, ont été vus PAR HASARD : en ouvrant l'app au
 * moment de la journée où ça se voyait. Ouvrir l'app une fois, c'est
 * essayer une heure sur vingt-quatre et croire qu'on a regardé.
 *
 * Le dernier de la liste le montre bien. La ligne « une heure seulement,
 * vers 7 h » avait été écrite pour réparer un mensonge — et elle était
 * nichée dans une condition qui l'effaçait quand l'éclaircie tombait le
 * JOUR MÊME, c'est-à-dire précisément quand elle presse. Écrite à 20 h,
 * vérifiée à 20 h, cassée à 3 h. Cette boucle l'a vue au premier passage.
 *
 * Playwright sait mentir sur l'horloge du navigateur. On ne teste donc plus
 * l'heure qu'il est : on teste la journée.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️  CE FICHIER NE TOURNE PAS DANS « npm test ».
 *
 * Il lui faut un export web (une minute et demie), un serveur local et un
 * Chromium. Voir LISEZ-MOI.md, à côté. Il se lance à la main avant une
 * publication, quand on a touché à l'affichage.
 */

const { lancer } = require('./pw');

const URL = process.env.MATAI_URL || 'http://localhost:8099/';

/** Les coupures réseau viennent du bac à sable, pas de l'application. */
const DU_BAC_A_SABLE = /404|ERR_TUNNEL|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|favicon/i;

/**
 * Heures locales de Tahiti (UTC−10) à visiter. Elles ne sont pas prises au
 * hasard : chacune est une charnière où quelque chose a déjà cassé.
 */
const HEURES = [
  { h: '03:00', quand: 'aube' },  // nuit noire, mais le jour à venir est AUJOURD'HUI
  { h: '06:30', quand: 'jour' },  // le soleil vient de se lever : la bascule
  { h: '09:00', quand: 'jour' },  // plein matin, le cas ordinaire
  { h: '12:00', quand: 'jour' },  // midi : le soleil au zénith, l'azimut à mi-course
  { h: '17:00', quand: 'jour' },  // fin d'après-midi : les créneaux se referment
  { h: '18:30', quand: 'soir' },  // juste après le coucher : 22 min de crépuscule ici
  { h: '22:00', quand: 'soir' }   // soirée : tout doit parler de demain
];

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  IL Y A DEUX NUITS, ET ELLES NE PARLENT PAS DU MÊME JOUR.
 *
 * À 22 h, la journée à venir est DEMAIN. À 3 h du matin, elle est
 * AUJOURD'HUI — le soleil se lève dans trois heures. L'accueil disait
 * « Demain s'annonce bien » dans les deux cas, et affichait avec lui les
 * températures extrêmes du jour SUIVANT.
 *
 * Trois heures du matin n'est pas une heure d'école : c'est celle où part
 * le pêcheur, et c'est pour lui que la sortie au large porte `avantAube`.
 * L'écran lui parlait du mauvais jour, précisément à ce moment-là.
 * ═══════════════════════════════════════════════════════════════════════
 */
function verifierLeJour(quand, accueil) {
  // ⚠️  On vise le VERDICT et la ligne des extrêmes, pas le mot « demain »
  // n'importe où. Les trois vignettes de jours s'appellent légitimement
  // « aujourd'hui / demain / après-demain » : une recherche large les prend
  // pour la faute et rend le test inutilisable. Premier jet, corrigé aussitôt.
  const verdictDemain = /Demain s’annonce|Demain se méritera|Demain, pas pour|Demain, je ne sais/;
  const extremesDemain = /demain\s+↑/;
  const parleDeDemain = verdictDemain.test(accueil) || extremesDemain.test(accueil);

  if (quand === 'aube' && parleDeDemain) {
    return 'l’accueil parle de « demain » avant l’aube — le jour qui se lève'
         + ' dans quelques heures est AUJOURD’HUI';
  }
  if (quand === 'soir' && !parleDeDemain) {
    return 'l’accueil ne dit pas « demain » après la tombée du jour —'
         + ' le verdict porte pourtant sur le lendemain';
  }
  return null;
}

/** Ce qui ne doit JAMAIS atteindre l'écran d'un pêcheur. */
const INTERDITS = [
  { motif: /\bundefined\b/,     dit: 'un « undefined » à l’écran' },
  { motif: /\bnull\b/,          dit: 'un « null » à l’écran' },
  { motif: /\bNaN\b/,           dit: 'un « NaN » à l’écran' },
  { motif: /\bInvalid Date\b/,  dit: 'une date invalide' },
  { motif: /\[object Object\]/, dit: 'un objet affiché brut' },
  { motif: /—\s*nœuds/,         dit: 'une vitesse de vent vide' },
  // ⚠️  \b DEVANT « de ». Sans lui, ce motif attrapait « latitu(de) — moitié
  // moins qu'en Europe » dans une phrase parfaitement saine, et signalait
  // une direction vide à chacun des sept passages. Un garde-fou qui crie
  // pour rien apprend à ne plus l'écouter : c'est pire que pas de garde-fou.
  { motif: /\bde\s+—/,         dit: 'une direction vide' },
  { motif: /\bvers\s+—/,        dit: 'une heure vide' },
  { motif: /à\s+—\s*h/,         dit: 'une heure vide' }
];

/** La durée réelle d'un créneau lu à l'écran, en heures. */
function duree(d, f, lendemain) {
  return lendemain ? (24 - d) + f : f - d;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  LE TITRE D'UNE LISTE DOIT DIRE LE MÊME JOUR QUE SES LIGNES.
 *
 * À 22 h, les deux écrans affichaient :
 *
 *     Vos activités AUJOURD’HUI
 *       Randonnée jet-ski      DEMAIN de 7 h à 9 h
 *       Plongée dans le lagon  DEMAIN de 7 h à 13 h
 *
 * Le titre contredisait chacune des lignes qu'il coiffait. Un lecteur ne
 * s'arrête pas sur une contradiction pareille : il en retient une des deux,
 * et une fois sur deux c'est la mauvaise.
 *
 * ⚠️  ET CE N'EST PAS « TOUS LES CRÉNEAUX SONT DE DEMAIN ».
 *
 * Premier jet du contrôle : signaler dès que le titre dit « aujourd'hui » et
 * que toutes les lignes disent « demain ». Il tombait à 12 h, 17 h et 18 h 30
 * — et il avait tort trois fois sur trois. À 17 h l'écran dit :
 *
 *     Que faire aujourd’hui
 *       Randonnée  FAVORABLE  demain de 7 h à 18 h
 *
 * Ce n'est pas une contradiction : la pastille juge MAINTENANT, en plein
 * jour, et la ligne dit quand s'ouvre la prochaine fenêtre exploitable. Deux
 * faits différents, chacun daté. Titrer « demain » y serait faux — le
 * verdict, lui, porte bien sur aujourd'hui.
 *
 * L'invariant juste est plus étroit : le titre nomme le jour de la PREMIÈRE
 * HEURE DE JOUR RESTANTE, celle sur laquelle le verdict est calculé. En
 * journée et avant l'aube, c'est aujourd'hui. Après la tombée du jour, il
 * n'en reste aucune : c'est demain.
 * ═══════════════════════════════════════════════════════════════════════
 */
function verifierTitreListe(quand, texte) {
  const t = texte.match(/(?:Que faire|Vos activités) (aujourd’hui|demain|après-demain)/);
  if (!t) return null;

  const attendu = quand === 'soir' ? 'demain' : 'aujourd’hui';
  if (t[1] !== attendu) {
    return 'la liste est titrée « ' + t[0] + ' » ; à ce moment de la journée'
      + ' le verdict porte sur « ' + attendu + ' »';
  }
  return null;
}

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

  for (const { h: hl, quand: moment } of HEURES) {
    const quand = new Date(Date.parse('2026-03-20T' + hl + ':00Z') + 10 * 3600000);

    const page = await nav.newPage({ viewport: { width: 400, height: 900 } });
    await page.clock.install({ time: quand });

    page.on('pageerror', (e) => soucis.push(hl + ' — erreur JS : ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !DU_BAC_A_SABLE.test(m.text())) {
        soucis.push(hl + ' — console : ' + m.text());
      }
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    console.log('\n╔═══ ' + hl + ' (heure de Tahiti) ═══');

    async function relire(ecran) {
      const texte = await page.evaluate(() => document.body.innerText);
      const ou = hl + ' / ' + ecran + ' : ';

      for (const i of INTERDITS) {
        if (i.motif.test(texte)) soucis.push(ou + i.dit);
      }

      // Aucun créneau ne doit enjamber la nuit.
      for (const c of texte.matchAll(/de (\d+) h à (\d+) h( le lendemain)?/g)) {
        const d = duree(+c[1], +c[2], !!c[3]);
        if (d > 16) soucis.push(ou + 'créneau de ' + d + ' h — « ' + c[0] + ' »');
      }

      // ⚠️  Un verdict favorable doit TOUJOURS porter une heure : un créneau,
      // une éclaircie brève, ou la mention du jour sur lequel il porte. Sans
      // ça, la vignette dit « c'est bon » sans dire quand — et le loueur
      // prépare ses planches pour rien.
      const vignettes = texte.split(
        /\n(?=[A-ZÉÈÀÇ][^\n]{2,40}\n(?:FAVORABLE|PRUDENCE|DÉFAVORABLE))/);
      for (const v of vignettes) {
        if (!/FAVORABLE/.test(v) || /DÉFAVORABLE/.test(v)) continue;
        if (/de \d+ h à|une heure seulement|jugé sur/.test(v)) continue;
        soucis.push(ou + 'verdict favorable sans aucune heure — « '
          + v.split('\n').filter(Boolean).slice(0, 2).join(' / ') + ' »');
      }

      const fauteTitre = verifierTitreListe(moment, texte);
      if (fauteTitre) soucis.push(ou + fauteTitre);

      // ═══════════════════════════════════════════════════════════════
      // ⚠️  LA CARTE DE L'ÎLE DOIT ÊTRE ATTEIGNABLE.
      //
      // Elle a disparu DEUX FOIS en deux heures, par deux chemins
      // différents :
      //
      //   1. l'onglet CARTE a été remplacé par CIEL ; l'écran est resté
      //      dans le dossier, son import dans App.js, et plus rien ne le
      //      rendait ;
      //   2. remise dans CIEL, elle s'est retrouvée APRÈS un retour
      //      anticipé « pas encore d'images » — donc invisible hors ligne,
      //      c'est-à-dire au premier lancement.
      //
      // Aucun banc ne s'en plaignait : un test vérifie ce qu'il voit, pas
      // ce qui a cessé d'exister. Et ce qui avait cessé d'exister, c'était
      // le trait de côte tiré d'OpenStreetMap, les récifs barrière relevés
      // île par île et les points de mesure à leurs vraies coordonnées.
      //
      // L'attribution OSM est obligatoire sous licence ODbL : sa présence
      // prouve que la carte est bien rendue, et son absence serait de toute
      // façon une faute.
      // ═══════════════════════════════════════════════════════════════
      if (ecran === 'CIEL' && !/OpenStreetMap/.test(texte)) {
        soucis.push(ou + 'la carte de l’île n’est pas rendue — pas d’attribution '
          + 'OpenStreetMap sur l’écran qui doit la porter');
      }

      return texte;
    }

    const accueil = await relire('accueil');
    const fauteJour = verifierLeJour(moment, accueil);
    if (fauteJour) soucis.push(hl + ' / accueil : ' + fauteJour);
    console.log('  accueil  : '
      + accueil.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8).join(' | '));

    await page.locator('text=Plus de détail').first().click();
    await page.waitForTimeout(1200);

    for (const onglet of ONGLETS) {
      // ACCUEIL est volontairement absent : il renvoie en mode simple et
      // démonte la barre d'onglets sous les pieds de la boucle.
      await page.locator('[role="tab"][aria-label="' + onglet + '"]').first().click();
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      const t = await relire(onglet);
      const cre = [...t.matchAll(/de (\d+) h à (\d+) h( le lendemain)?/g)].map((c) => c[0]);
      console.log('  ' + onglet.padEnd(8) + ' : ' + (cre.length ? cre.join('  ') : '—'));
    }

    await page.close();
  }

  console.log('\n' + (soucis.length
    ? '✗ ' + soucis.length + ' souci(s) :\n  ' + soucis.join('\n  ')
    : '✓ rien à signaler sur ' + HEURES.length + ' heures × '
      + (ONGLETS.length + 1) + ' écrans'));

  await nav.close();
  process.exit(soucis.length ? 1 : 0);
})();
