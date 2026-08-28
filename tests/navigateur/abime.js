/**
 * Mata'i — des paquets abîmés, servis à l'application RÉELLE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ALORS QUE `04-degrade.js` EXISTE DÉJÀ
 *
 * `04-degrade.js` casse douze paquets et monte les quatre écrans avec un
 * moteur de rendu de substitution. C'est rapide, ça tourne à chaque
 * publication, et ça a déjà attrapé « Vent — nœuds, de null ».
 *
 * Mais ce moteur n'est pas celui du téléphone. Il ne sait rien des
 * `Animated`, des `FlatList`, des mesures de mise en page, ni de ce que
 * React fait vraiment quand une valeur passe de `12` à `null` entre deux
 * rendus. Or c'est là que se logent les fautes qui restent :
 *
 *   — un composant qui plante au SECOND rendu, pas au premier ;
 *   — un `toFixed()` sur une valeur devenue nulle après une mise à jour ;
 *   — un écran qui reste sur l'ancienne donnée au lieu de se taire.
 *
 * Ce fichier reprend donc les avaries de `04-degrade.js` et les sert par le
 * réseau à l'application réellement exportée. Même liste d'interdits : ce
 * n'est pas le plantage qu'on craint, c'est le CHIFFRE INVENTÉ.
 *
 *     « UV 0 » à midi, « vent 0 nœud » sur un champ absent,
 *     « houle 0,0 m » quand l'API marine n'a rien renvoyé.
 *
 * Un tiret, « inconnue », un silence : tout va. Un zéro rassurant, non — car
 * c'est celui-là qui met quelqu'un à l'eau.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️  Comme ses voisins, il ne tourne pas dans « npm test ». Voir LISEZ-MOI.md.
 */

const fs = require('fs');
const path = require('path');

const { lancer } = require('./pw');

const URL = process.env.MATAI_URL || 'http://localhost:8099/';
const PAQUETS = process.env.MATAI_PAQUETS || path.resolve(__dirname, '..', '..', 'paquets');

const DU_BAC_A_SABLE = /404|ERR_TUNNEL|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|favicon/i;

/** Ce qui ne doit JAMAIS atteindre l'écran quand la donnée est absente. */
const INTERDITS = [
  { quoi: 'indice UV inventé',    re: /\bUV\s*0\b|indice\s*UV\s*:?\s*0\b/i },
  { quoi: 'vent nul inventé',     re: /\b0\s*(nds|nœuds|noeuds)\b/i },
  { quoi: 'houle nulle inventée', re: /\b0[,.]0\s*m\b/ },
  { quoi: 'NaN à l’écran',        re: /NaN/ },
  { quoi: 'undefined à l’écran',  re: /undefined/ },
  { quoi: 'null à l’écran',       re: /\bnull\b/ },
  { quoi: 'objet affiché brut',   re: /\[object Object\]/ }
];

const JOUR = 86400000;

/** Recale le paquet sur l'horloge simulée, par multiples de 24 h. */
function redater(p, versUTC) {
  const s = p.spots || [];
  const pr = s[0] && s[0].heures && s[0].heures[0];
  if (!pr) return p;
  const voulu = versUTC.getTime() - 10 * 3600000 - 10 * 3600000;
  const dec = Math.round((voulu - Date.parse(pr.t + ':00Z')) / JOUR) * JOUR;
  if (dec) for (const sp of s) for (const h of sp.heures || []) {
    h.t = new Date(Date.parse(h.t + ':00Z') + dec).toISOString().slice(0, 16);
  }
  p.genere = new Date(versUTC.getTime() - 3600000).toISOString();
  if (p.expire) p.expire = new Date(versUTC.getTime() + 12 * 3600000).toISOString();
  return p;
}

/** Les avaries, reprises de `04-degrade.js`. */
const CAS = [
  ['paquet sans aucun spot', (p) => { p.spots = []; return p; }],
  ['spots absents du tout', (p) => { delete p.spots; return p; }],
  ['spot sans aucune heure', (p) => { for (const s of p.spots) s.heures = []; return p; }],
  ['heures absentes du tout', (p) => { for (const s of p.spots) delete s.heures; return p; }],

  ['API marine muette : houle nulle partout', (p) => {
    for (const s of p.spots) {
      s.erreurMarine = 'HTTP 503';
      for (const h of s.heures || []) { h.houle = null; h.periode = null; h.houleDir = null; }
    }
    return p;
  }],

  ['vent nul : le champ indispensable manque', (p) => {
    for (const s of p.spots) for (const h of s.heures || []) {
      h.vent = null; h.rafale = null; h.dir = null;
    }
    return p;
  }],

  ['champs bonus tous nuls', (p) => {
    for (const s of p.spots) for (const h of s.heures || []) {
      h.uv = null; h.uvClair = null; h.temp = null; h.ciel = null; h.pluie = null;
    }
    return p;
  }],

  ['toutes les heures dans le passé', (p) => {
    for (const s of p.spots) {
      s.heures = (s.heures || []).map((h, i) => ({
        ...h, t: '2020-01-0' + ((i % 8) + 1) + 'T0' + (i % 10) + ':00'
      }));
    }
    return p;
  }],

  ['une heure sur deux amputée', (p) => {
    for (const s of p.spots) {
      (s.heures || []).forEach((h, i) => {
        if (i % 2) { h.vent = null; h.houle = null; h.temp = null; h.ciel = null; }
      });
    }
    return p;
  }],

  ['paquet vide de tout', () => ({ version: 1, ile: 'bora-bora', nom: 'Bora Bora' })],

  // ═══════════════════════════════════════════════════════════════════════
  // LES CHAMPS NEUFS. Ils n'étaient éprouvés par rien.
  //
  // Chacun de ceux-ci correspond à un vrai mode de panne : une API qui
  // change de forme, un vieux paquet resté en cache sur un téléphone, une
  // station qui renvoie n'importe quoi. L'application doit se taire
  // proprement sur chacun — jamais inventer, jamais planter.
  // ═══════════════════════════════════════════════════════════════════════

  // Un paquet d'AVANT le tableau des cinq jours : le téléphone l'a en
  // cache, l'écran doit se replier sur les 48 h et le dire.
  ['sans tranches (paquet ancien)', (p) => {
    for (const s of p.spots) delete s.tranches;
    return p;
  }],

  // Les tranches existent mais sont vides : pire qu'absentes, parce que le
  // repli ne se déclenche pas.
  ['tranches vides', (p) => {
    for (const s of p.spots) s.tranches = [];
    return p;
  }],

  // La houle longue manque, alors que la mer totale est là. Le tableau des
  // cinq jours ne doit pas afficher la mer totale à sa place en silence.
  ['houle longue absente', (p) => {
    for (const s of p.spots) {
      for (const h of s.heures || []) { h.swell = null; h.swellPer = null; h.swellDir = null; }
      for (const t of s.tranches || []) { t.houle = null; t.periode = null; t.houleDir = null; }
    }
    return p;
  }],

  // Une station de mesure qui répond n'importe quoi.
  ['mesure aberrante', (p) => {
    p.mesure = {
      station: { nom: 'Station cassée', oaci: 'ZZZZ' },
      distanceKm: null,
      dernier: { t: 'pas une date', vent: 'beaucoup', dir: 'nord', variable: null },
      releves: [{ t: 'pas une date', vent: null, dir: null }],
      erreur: null
    };
    return p;
  }],

  // Un relevé daté DANS LE FUTUR : l'horloge du téléphone a dérivé.
  ['mesure datée dans le futur', (p) => {
    const futur = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 16) + 'Z';
    p.mesure = {
      station: { nom: 'Tahiti-Faa’a', oaci: 'NTAA' },
      distanceKm: 3,
      dernier: { t: futur, vent: 42, rafale: 60, dir: 90, variable: false },
      releves: [{ t: futur, vent: 42, dir: 90 }],
      erreur: null
    };
    return p;
  }],

  // Le fuseau horaire manque ou est absurde.
  ['décalage horaire absurde', (p) => {
    p.decalage = 'midi';
    p.fuseau = null;
    return p;
  }],

  // Les dates de mise à jour sont incohérentes.
  ['dates de mise à jour cassées', (p) => {
    p.majReelle = 'hier';
    p.prochaine = null;
    p.republications = -3;
    return p;
  }],

  // Une vigilance dans un état que l'application ne connaît pas.
  ['vigilance d’un niveau inconnu', (p) => {
    p.vigilance = { etat: 'turquoise', zone: null, phenomenes: [{ nom: 42 }], maj: 'jamais' };
    return p;
  }]
];

/**
 * Les onglets de la barre du bas.
 *
 * ⚠️  ACCUEIL est volontairement absent : il renvoie en mode simple et
 * démonte la barre sous les pieds de la boucle. PRO aussi : ce n'est plus
 * un onglet mais une bascule en haut de SORTIE.
 */
const ONGLETS = ['MESURES', '5 JOURS', 'CIEL', 'ASTRES', 'SORTIE'];

(async () => {
  const source = path.join(PAQUETS, 'bora-bora.json');
  if (!fs.existsSync(source)) {
    console.error('Aucun paquet sous la main — lancer « npm run demo » d’abord.');
    process.exit(2);
  }
  const SAIN = fs.readFileSync(source, 'utf8');

  const nav = await lancer();
  const soucis = [];
  let vues = 0;

  for (const [nom, abimer] of CAS) {
    // Deux heures : midi (tout doit être dit) et 22 h (tout porte sur demain).
    for (const hl of ['12:00', '22:00']) {
      const quand = new Date(Date.parse('2026-03-20T' + hl + ':00Z') + 10 * 3600000);
      const page = await nav.newPage({ viewport: { width: 400, height: 900 } });
      await page.clock.install({ time: quand });

      let servi = 0;
      await page.route('**/paquets/**', async (route) => {
        const f = decodeURIComponent(route.request().url().split('/').pop().split('?')[0]);
        if (f !== 'bora-bora.json') {
          const sur = path.join(PAQUETS, f);
          return fs.existsSync(sur)
            ? route.fulfill({ status: 200, contentType: 'application/json',
                              body: fs.readFileSync(sur, 'utf8') })
            : route.fulfill({ status: 404, body: 'absent' });
        }
        servi++;
        const p = abimer(redater(JSON.parse(SAIN), quand)) || {};
        await route.fulfill({ status: 200, contentType: 'application/json',
                              body: JSON.stringify(p) });
      });
      await page.route('**/nuages/**', (r) => r.fulfill({ status: 404, body: 'absent' }));

      // ⚠️  Un plantage compte. C'est la faute VISIBLE, la moins grave des
      // deux, mais elle reste une faute.
      page.on('pageerror', (e) => soucis.push(nom + ' ' + hl + ' — l’app plante : ' + e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !DU_BAC_A_SABLE.test(m.text())) {
          soucis.push(nom + ' ' + hl + ' — console : ' + m.text());
        }
      });

      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2600);

      async function relire(ecran) {
        const t = await page.evaluate(() => document.body.innerText);
        vues++;
        for (const i of INTERDITS) {
          if (i.re.test(t)) {
            const m = t.match(i.re);
            soucis.push(nom + ' ' + hl + ' / ' + ecran + ' : ' + i.quoi
              + ' — « ' + (m ? m[0] : '?') + ' »');
          }
        }
        return t;
      }

      const acc = await relire('accueil');
      let etat = acc.trim() ? 'écran rempli' : '⚠ écran VIDE';

      try {
        await page.locator('text=Plus de détail').first().click({ timeout: 4000 });
        await page.waitForTimeout(1000);
        for (const o of ONGLETS) {
          await page.locator('[role="tab"][aria-label="' + o + '"]').first().click();
          await page.waitForTimeout(900);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(350);
          await relire(o);
        }
      } catch (e) {
        // Un paquet vide peut légitimement ne pas ouvrir le détail : ce n'est
        // une faute que si l'accueil ne dit rien non plus.
        etat += ', détail inaccessible';
        if (!acc.trim()) {
          soucis.push(nom + ' ' + hl + ' : ni accueil ni détail — l’app ne dit rien du tout');
        }
      }

      if (!servi) {
        soucis.push(nom + ' ' + hl + ' : le paquet abîmé n’a jamais été demandé');
      }
      console.log('  ' + (nom + ' ').padEnd(42, '·') + ' ' + hl + '  ' + etat);
      await page.close();
    }
  }

  console.log('\n' + vues + ' écrans relus sur ' + CAS.length + ' avaries × 2 heures');
  console.log(soucis.length
    ? '✗ ' + soucis.length + ' souci(s) :\n  ' + soucis.join('\n  ')
    : '✓ aucun chiffre inventé, aucun plantage');

  await nav.close();
  process.exit(soucis.length ? 1 : 0);
})();
