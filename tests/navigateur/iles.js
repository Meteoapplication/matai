/**
 * Mata'i — les neuf îles, chacune relue à quatre heures de la journée.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, À CÔTÉ DE horloges.js
 *
 * `horloges.js` ouvre l'application hors ligne. Elle affiche donc son paquet
 * embarqué, et rien d'autre : Bora Bora, quatre points de mesure, un récif,
 * un point au large. L'île la mieux dotée des neuf.
 *
 * Or c'est ailleurs que l'application doit se taire :
 *
 *   — Moorea et Raiatea n'ont AUCUN point au large. Une plongée extérieure
 *     n'y a pas de mesure honnête, et la règle du projet interdit de se
 *     rabattre sur le lagon : le lagon est calme par construction.
 *   — Fakarava n'a que des passes.
 *   — Tubuai n'a qu'un seul point.
 *   — Rangiroa et Nuku Hiva n'ont pas de récif barrière à tracer.
 *   — Les Marquises sont à UTC−9 h 30, pas −10 : une demi-heure de décalage
 *     que tout le reste du code ignore.
 *
 * Ces chemins-là ne sont jamais rendus quand on ouvre l'app sur son bureau.
 * Ce sont pourtant ceux où un affichage vide se lit comme une mer calme.
 *
 * Ce fichier détourne donc les requêtes de l'app vers les paquets construits
 * en local (`npm run demo`), et les REDATE au vol sur l'horloge simulée —
 * sinon l'app les jugerait périmés et se tairait pour la mauvaise raison.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️  Comme horloges.js, il ne tourne pas dans « npm test ». Voir LISEZ-MOI.md.
 */

const fs = require('fs');
const path = require('path');

const { lancer } = require('./pw');

const URL = process.env.MATAI_URL || 'http://localhost:8099/';
const PAQUETS = process.env.MATAI_PAQUETS || path.resolve(__dirname, '..', '..', 'paquets');

const DU_BAC_A_SABLE = /404|ERR_TUNNEL|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|favicon/i;

const ILES = [
  { id: 'bora-bora', nom: 'Bora Bora', dec: -10 },
  { id: 'tahiti',    nom: 'Tahiti',    dec: -10 },
  { id: 'moorea',    nom: 'Moorea',    dec: -10,   attendu: 'aucun point au large' },
  { id: 'raiatea',   nom: 'Raiatea',   dec: -10,   attendu: 'aucun point au large' },
  { id: 'rangiroa',  nom: 'Rangiroa',  dec: -10,   attendu: 'pas de récif tracé' },
  { id: 'fakarava',  nom: 'Fakarava',  dec: -10,   attendu: 'que des passes' },
  { id: 'nuku-hiva', nom: 'Nuku Hiva', dec: -9.5,  attendu: 'Marquises, UTC−9 h 30' },
  { id: 'tubuai',    nom: 'Tubuai',    dec: -10,   attendu: 'un seul point' },
  { id: 'gambier',   nom: 'Gambier',   dec: -9 }
];

const HEURES = ['06:30', '12:00', '18:30', '22:00'];

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

/**
 * Redate un paquet sur l'horloge simulée.
 *
 * ⚠️  Sans ça, l'app juge le paquet périmé et n'affiche rien — et on lirait
 * ce silence comme un défaut d'île alors que c'est un défaut de date. Une
 * donnée de test à la mauvaise forme cache le défaut qu'elle devrait révéler ;
 * cette leçon a déjà coûté une journée sur `03-jour.js`.
 */
function redater(paquet, versUTC, dec) {
  const spots = paquet.spots || [];
  const premier = spots[0] && spots[0].heures && spots[0].heures[0];
  if (!premier) return paquet;

  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️  ON DÉCALE D'UN NOMBRE ENTIER DE JOURS. DEUX RAISONS, TOUTES DEUX
  // APPRISES EN SE TROMPANT.
  //
  // 1. Pas sur la date UTC. Tahiti est à UTC−10 : à 18 h 30 et à 22 h
  //    LOCALES, la date UTC a déjà basculé au lendemain. Caler le paquet sur
  //    elle le faisait commencer cinq heures et demie DANS LE FUTUR. L'app
  //    n'avait plus aucune heure pour « maintenant » et se rabattait sur la
  //    première disponible : les deux passages du soir ne testaient pas le
  //    soir, ils testaient un paquet entièrement à venir — et ils passaient
  //    au vert. Rien ne l'aurait signalé ; il a fallu confronter le vent
  //    affiché à la courbe du paquet sur le disque.
  //
  // 2. Pas sur minuit non plus. Le paquet commence à 20 h, pas à 0 h. Le
  //    recaler sur minuit décale toute la courbe de quatre heures : l'alizé
  //    ne tomberait plus la nuit mais en fin de matinée. Or c'est justement
  //    parce que le vent tombe la nuit que la borne du jour existe. Un jeu
  //    d'essai qui déphase le cycle diurne éteint le défaut qu'il traque —
  //    exactement ce qui s'était produit sur `03-jour.js`.
  //
  // Un multiple de 24 h préserve l'heure du jour de chaque point. On choisit
  // le jour qui place le début du paquet une dizaine d'heures avant l'instant
  // simulé, comme un vrai paquet du matin.
  // ═══════════════════════════════════════════════════════════════════════
  const JOUR = 86400000;
  const origine = Date.parse(premier.t + ':00Z');
  const voulu = versUTC.getTime() + dec * 3600000 - 10 * 3600000;
  const decalage = Math.round((voulu - origine) / JOUR) * JOUR;
  if (!decalage) return paquet;

  const bouger = (t) => new Date(Date.parse(t + ':00Z') + decalage).toISOString().slice(0, 16);

  for (const s of spots) {
    for (const h of s.heures || []) h.t = bouger(h.t);
  }
  paquet.genere = new Date(versUTC.getTime() - 3600000).toISOString();
  if (paquet.expire) paquet.expire = new Date(versUTC.getTime() + 12 * 3600000).toISOString();
  return paquet;
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
  if (!fs.existsSync(PAQUETS)) {
    console.error('Aucun paquet dans ' + PAQUETS + ' — lancer « npm run demo » d’abord.');
    process.exit(2);
  }

  const nav = await lancer();
  const soucis = [];
  let vues = 0;

  for (const ile of ILES) {
    const fichier = path.join(PAQUETS, ile.id + '.json');
    if (!fs.existsSync(fichier)) {
      soucis.push(ile.nom + ' : aucun paquet ' + ile.id + '.json');
      continue;
    }

    console.log('\n╔═══ ' + ile.nom + (ile.attendu ? '  (' + ile.attendu + ')' : '') + ' ═══');

    for (const hl of HEURES) {
      const quand = new Date(Date.parse('2026-03-20T' + hl + ':00Z') - ile.dec * 3600000);
      const page = await nav.newPage({ viewport: { width: 400, height: 900 } });
      await page.clock.install({ time: quand });

      // ── détourner les requêtes de paquets vers le disque
      //
      // ⚠️  On compte ce qui est RÉELLEMENT servi. Sans ce compteur, une
      // interception qui ne prend pas (mauvais motif, requête mise en cache)
      // laisse l'app afficher son paquet embarqué — Bora Bora — pendant que
      // l'entête, elle, porte bien le nom de l'île demandée. Neuf îles vertes
      // et une seule réellement regardée : le pire résultat possible, parce
      // qu'il rassure.
      let servi = 0;
      await page.route('**/paquets/**', async (route) => {
        const cible = route.request().url();
        const nom = decodeURIComponent(cible.split('/').pop().split('?')[0]);
        const sur = path.join(PAQUETS, nom);
        if (!fs.existsSync(sur)) return route.fulfill({ status: 404, body: 'absent' });
        if (nom === ile.id + '.json') servi++;
        const contenu = redater(JSON.parse(fs.readFileSync(sur, 'utf8')), quand, ile.dec);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(contenu)
        });
      });
      // Les images satellite ne sont pas le sujet ici.
      await page.route('**/nuages/**', (r) => r.fulfill({ status: 404, body: 'absent' }));

      page.on('pageerror', (e) => soucis.push(ile.nom + ' ' + hl + ' — erreur JS : ' + e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !DU_BAC_A_SABLE.test(m.text())) {
          soucis.push(ile.nom + ' ' + hl + ' — console : ' + m.text());
        }
      });

      // ── choisir l'île AVANT le premier rendu
      //
      // ⚠️  On ne peut pas passer par le sélecteur : hors ligne, il ne
      // propose que Bora Bora (le manifeste de secours n'en connaît qu'une).
      // La préférence est écrite là où AsyncStorage la range sur le web.
      await page.addInitScript((id) => {
        try { window.localStorage.setItem('matai:pref:ile', JSON.stringify(id)); } catch (e) {}
      }, ile.id);

      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);

      async function relire(ecran) {
        const texte = await page.evaluate(() => document.body.innerText);
        const ou = ile.nom + ' ' + hl + ' / ' + ecran + ' : ';

        for (const i of INTERDITS) if (i.motif.test(texte)) soucis.push(ou + i.dit);

        for (const c of texte.matchAll(/de (\d+) h à (\d+) h( le lendemain)?/g)) {
          const d = c[3] ? (24 - +c[1]) + +c[2] : +c[2] - +c[1];
          if (d > 16) soucis.push(ou + 'créneau de ' + d + ' h — « ' + c[0] + ' »');
        }

        const vignettes = texte.split(
          /\n(?=[A-ZÉÈÀÇ][^\n]{2,40}\n(?:FAVORABLE|PRUDENCE|DÉFAVORABLE))/);
        for (const v of vignettes) {
          if (!/FAVORABLE/.test(v) || /DÉFAVORABLE/.test(v)) continue;
          if (/de \d+ h à|une heure seulement|jugé sur/.test(v)) continue;
          soucis.push(ou + 'verdict favorable sans aucune heure — « '
            + v.split('\n').filter(Boolean).slice(0, 2).join(' / ') + ' »');
        }
        return texte;
      }

      const accueil = await relire('accueil');
      vues++;

      // Est-ce bien l'île demandée qui s'affiche ?
      if (!accueil.includes(ile.nom)) {
        soucis.push(ile.nom + ' ' + hl + ' : l’écran ne porte pas le nom de l’île');
      }
      if (!servi) {
        soucis.push(ile.nom + ' ' + hl + ' : le paquet ' + ile.id
          + '.json n’a jamais été demandé — l’app montre autre chose');
      }

      let resume = '';
      try {
        await page.locator('text=Plus de détail').first().click({ timeout: 4000 });
        await page.waitForTimeout(1000);
        for (const onglet of ONGLETS) {
          await page.locator('[role="tab"][aria-label="' + onglet + '"]').first().click();
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(400);
          const t = await relire(onglet);
          vues++;
          // ⚠️  On imprime les créneaux EUX-MÊMES, pas leur nombre.
          // Le compte seul se ressemblait d'une île à l'autre et d'une heure
          // à l'autre — il m'a fait croire un moment que le détournement ne
          // marchait pas. Un journal qui ne distingue rien ne prouve rien.
          const cre = [...t.matchAll(/de \d+ h à \d+ h( le lendemain)?/g)].map((m) => m[0]);
          const muet = /Pas de point de mesure assez exposé/.test(t);
          const l = t.split('\n').map((x) => x.trim()).filter(Boolean);
          const iv = l.indexOf('Vent');
          if (onglet === 'SORTIE') resume += '\n    vent   ' + (iv >= 0 ? l[iv + 1] : '?');
          resume += '\n    ' + onglet.padEnd(6) + ' ' + (cre.join('  ') || '—')
            + (muet ? '   [se tait sur l’extérieur]' : '');
        }
      } catch (e) {
        soucis.push(ile.nom + ' ' + hl + ' : impossible d’atteindre le détail — ' + e.message);
      }

      console.log('  ' + hl + resume);
      await page.close();
    }
  }

  console.log('\n' + vues + ' écrans relus');
  console.log(soucis.length
    ? '✗ ' + soucis.length + ' souci(s) :\n  ' + soucis.join('\n  ')
    : '✓ rien à signaler');

  await nav.close();
  process.exit(soucis.length ? 1 : 0);
})();
