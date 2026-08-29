/**
 * L'imagerie ne doit plus être noire la nuit — et doit le dire.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER DÉMONTRE.
 *
 * La moitié de chaque journée, l'image principale de l'écran d'accueil
 * était un carré noir. GEOCOLOR s'appuie sur les lumières des villes et un
 * voile de nuages éclairé par la lune ; au-dessus du Pacifique il n'y a ni
 * l'une ni l'autre. Relevé sur le recadrage réellement publié le 28 août
 * 2026 : 17,8 sur 255 à 18 h 50 locales.
 *
 * La réparation montre l'infrarouge quand il fait nuit. Quatre choses
 * doivent tenir, et chacune casse en silence :
 *
 *   1. LA HAUTEUR DU SOLEIL. Le serveur a sa propre implémentation, par un
 *      chemin différent de celle de l'application (NOAA : année
 *      fractionnaire → équation du temps → angle horaire ; l'application :
 *      longitude écliptique → équatorial). Deux formules d'une même chose
 *      sont une dette, sauf si elles se contrôlent l'une l'autre. C'est ce
 *      que fait la première partie de cet essai — et c'est la seule qui
 *      protège contre une bascule à la mauvaise heure, partout, tout le
 *      temps.
 *
 *   2. LE SEUIL. Il est posé à +5° de hauteur au centre de l'emprise, entre
 *      les deux points mesurés qui l'encadrent (+9° → lisible, −0,3° →
 *      illisible). L'essai vérifie qu'il classe bien ces points mesurés.
 *
 *   3. LA BASCULE IMAGE PAR IMAGE. La boucle couvre deux heures et se met à
 *      cheval sur le coucher. Un canal unique pour toute la boucle
 *      garderait du visible déjà noir, ou passerait au gris deux heures
 *      trop tôt.
 *
 *   4. ⚠️  LE REPLI QUAND L'INFRAROUGE MANQUE. C'est le piège vicieux : le
 *      téléchargement infrarouge échoue seul, régulièrement — le journal de
 *      production le montre. Si l'index pointait quand même sur le fichier
 *      absent, l'application demanderait une image qui n'existe pas. Une
 *      case vide au milieu de la bande, ou l'animation qui s'arrête, et le
 *      flux resterait vert.
 *
 * Et une cinquième, côté application : elle doit DIRE que l'image est
 * infrarouge. Quelqu'un qui ouvre Mata'i le soir et découvre une image grise
 * doit comprendre qu'il regarde un autre capteur, pas une image abîmée.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const APP = path.resolve(RACINE, '..', 'matai-app');

module.exports = async function () {
  const fautes = [];
  const notes = [];

  const S = await import('file://' + path.join(RACINE, 'soleil.mjs'));
  const A = await import('file://' + path.join(RACINE, 'animation.mjs'));
  const N = await import('file://' + path.join(RACINE, 'nuages.mjs'));

  // ═════════════════════════════════════════════════════════════════════
  // ── 1. les deux implémentations du soleil se contrôlent
  // ═════════════════════════════════════════════════════════════════════
  const cheminApp = path.join(APP, 'src', 'soleil.js');
  if (!fs.existsSync(cheminApp)) {
    notes.push('src/soleil.js absent de cet arbre : le contre-calcul n’a pas pu être fait');
  } else {
    // L'application importe « ./lune » sans extension — Node ESM refuse.
    // On recopie les deux fichiers en corrigeant le spécificateur, ce qui
    // ne touche à aucune formule.
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'matai-soleil-'));
    try {
      for (const nom of ['lune.js', 'soleil.js']) {
        const src = fs.readFileSync(path.join(APP, 'src', nom), 'utf8');
        fs.writeFileSync(path.join(dossier, nom.replace(/\.js$/, '.mjs')),
          src.replace(/from\s+'\.\/lune'/g, "from './lune.mjs'"));
      }
      const App = await import('file://' + path.join(dossier, 'soleil.mjs'));

      // Six lieux répartis sur l'emprise, six dates dans l'année, toutes les
      // trois heures : solstices, équinoxes, et les heures de bascule.
      const lieux = [
        ['Nuku Hiva', -8.96, -140.1], ['Bora Bora', -16.462, -151.777],
        ['Tahiti', -17.547, -149.46], ['Rangiroa', -14.97, -147.68],
        ['Tubuai', -23.3, -149.5], ['Gambier', -23.085, -134.885]
      ];
      const dates = ['2026-01-15', '2026-03-20', '2026-06-21',
                     '2026-08-28', '2026-09-23', '2026-12-21'];

      let pire = 0, pireOu = '';
      let n = 0;
      for (const [nom, lat, lon] of lieux) {
        for (const j of dates) {
          for (let h = 0; h < 24; h += 3) {
            const d = new Date(`${j}T${String(h).padStart(2, '0')}:00:00Z`);
            const a = S.hauteurSoleil(d, lat, lon);
            const b = App.hauteur(d, lat, lon);
            if (!isFinite(a) || !isFinite(b)) {
              fautes.push('hauteur non finie à ' + nom + ' ' + d.toISOString());
              continue;
            }
            const e = Math.abs(a - b);
            n++;
            if (e > pire) { pire = e; pireOu = nom + ' ' + d.toISOString(); }
          }
        }
      }

      // Un demi-degré : le soleil parcourt ça en deux minutes. Largement
      // assez fin pour décider d'un canal d'image, et assez serré pour
      // attraper une formule fausse — une erreur de signe ou d'unité se
      // compte en dizaines de degrés, pas en dixièmes.
      //
      // ⚠️  L'écart réellement observé est de 0,445°, pas zéro : la formule
      // du serveur est la version courte de la NOAA, qui néglige les termes
      // supérieurs de l'équation du centre. Ce n'est donc pas une marge
      // confortable, c'est une marge JUSTE — et c'est voulu. Si quelqu'un
      // voit cet essai passer au rouge de peu, la question à se poser est
      // « qu'est-ce qui a changé dans l'une des deux formules », pas
      // « desserrons le seuil ».
      if (pire > 0.5) {
        fautes.push('LES DEUX CALCULS DU SOLEIL DIVERGENT de ' + pire.toFixed(2)
          + '° (' + pireOu + '). Celui de l’application est éprouvé contre une '
          + 'troisième implémentation et contre des horaires publiés ; c’est '
          + 'donc soleil.mjs, côté serveur, qu’il faut regarder. Tant que '
          + 'l’écart n’est pas expliqué, l’imagerie peut basculer à la '
          + 'mauvaise heure sans que rien ne le signale.');
      } else {
        notes.push(n + ' points comparés aux deux implémentations du soleil — '
          + 'écart maximal ' + pire.toFixed(3) + '°');
      }
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 2. le seuil classe correctement les points RÉELLEMENT MESURÉS
  // ═════════════════════════════════════════════════════════════════════
  {
    // Heure locale (UTC−10) du 28 août 2026, et luminance moyenne relevée
    // sur le recadrage régional publié. Voir nuages.mjs.
    const releves = [
      ['16:10', 90.9, 'visible'],
      ['16:50', 58.4, 'visible'],
      ['17:30', 24.0, 'infrarouge'],
      ['18:10', 18.7, 'infrarouge'],
      ['18:50', 17.8, 'infrarouge']
    ];
    const lignes = [];
    for (const [hl, lum, attendu] of releves) {
      const [hh, mm] = hl.split(':').map(Number);
      const d = new Date(Date.UTC(2026, 7, 28, hh + 10, mm));
      const obtenu = A.canalPourInstant(d);
      const haut = S.hauteurSoleil(d, N.CENTRE_REGION.lat, N.CENTRE_REGION.lon);
      lignes.push(hl + ' → ' + haut.toFixed(1) + '° ' + obtenu);
      if (obtenu !== attendu) {
        fautes.push('à ' + hl + ' locales la luminance mesurée valait ' + lum
          + '/255 et le canal devrait être « ' + attendu + ' », le seuil rend « '
          + obtenu + ' » (soleil à ' + haut.toFixed(1) + '°). '
          + (attendu === 'infrarouge'
             ? 'C’est le carré noir qui revient.'
             : 'On passe en gris alors que l’image en couleurs est encore bonne.'));
      }
    }
    if (!fautes.length) notes.push('les 5 relevés de luminance sont classés du bon côté : ' + lignes.join(' · '));
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 3. en plein jour tout est visible, en pleine nuit tout est infrarouge
  // ═════════════════════════════════════════════════════════════════════
  {
    const midi = new Date(Date.UTC(2026, 7, 28, 22, 0));    // 12 h locales
    const minuit = new Date(Date.UTC(2026, 7, 29, 10, 0));  // 00 h locales
    if (A.canalPourInstant(midi) !== 'visible') {
      fautes.push('à midi l’imagerie passerait en infrarouge — le seuil est à l’envers');
    }
    if (A.canalPourInstant(minuit) !== 'infrarouge') {
      fautes.push('à minuit l’imagerie resterait en lumière visible : c’est exactement '
        + 'le carré noir qu’on répare');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 4. ⚠️  le repli quand l'infrarouge manque
  // ═════════════════════════════════════════════════════════════════════
  {
    // Une boucle de nuit : douze créneaux à partir de 10 h UTC (minuit local).
    const nuit = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(2026, 7, 29, 10, i * 10));
      nuit.push(A.versHorodatage(d));
    }

    const toutLa = await A.construireImages(nuit, async () => true);
    if (!toutLa.every((im) => im.canal === 'infrarouge')) {
      fautes.push('la nuit, avec tout l’infrarouge présent, certaines images '
        + 'restent en visible : ' + toutLa.filter((i) => i.canal !== 'infrarouge').length + '/12');
    }
    if (!toutLa.every((im) => im.fichier.startsWith('nuages/anim-ir/'))) {
      fautes.push('le canal dit infrarouge mais le chemin pointe ailleurs');
    }

    // Rien sur le disque : tout doit retomber sur le visible, ET le dire.
    const rienLa = await A.construireImages(nuit, async () => false);
    const menteuses = rienLa.filter((im) =>
      im.fichier.includes('anim-ir') || im.canal === 'infrarouge');
    if (menteuses.length) {
      fautes.push('AUCUNE IMAGE INFRAROUGE SUR LE DISQUE et l’index en annonce '
        + 'quand même ' + menteuses.length + '/12. L’application demanderait des '
        + 'fichiers absents — case vide au milieu de la bande ou animation '
        + 'arrêtée — et le flux resterait vert.');
    }

    // Le cas réel : l'infrarouge manque sur une seule image.
    const trou = nuit[5];
    const partiel = await A.construireImages(nuit, async (h) => h !== trou);
    const celleDuTrou = partiel.find((im) => im.fichier.includes(trou));
    if (!celleDuTrou || celleDuTrou.canal !== 'visible'
        || celleDuTrou.fichier.includes('anim-ir')) {
      fautes.push('une seule image infrarouge manquante doit retomber sur le '
        + 'visible pour CELLE-LÀ seulement — obtenu : ' + JSON.stringify(celleDuTrou));
    }
    if (partiel.filter((im) => im.canal === 'infrarouge').length !== 11) {
      fautes.push('le trou d’une image en a entraîné d’autres avec lui');
    }
    if (!fautes.length) {
      notes.push('repli vérifié : infrarouge complet → 12/12, absent → 0/12 sans '
        + 'chemin mort, un seul trou → 11/12 et la douzième en visible');
    }

    // Et la bande à cheval sur le coucher doit être mixte.
    const soir = [];
    for (let i = 0; i < 12; i++) {
      // 16 h 20 → 18 h 10 locales, soit le coucher en plein milieu.
      const d = new Date(Date.UTC(2026, 7, 29, 2, 20 + i * 10));
      soir.push(A.versHorodatage(d));
    }
    const bande = await A.construireImages(soir, async () => true);
    const nbIr = bande.filter((im) => im.canal === 'infrarouge').length;
    if (nbIr === 0 || nbIr === 12) {
      fautes.push('une boucle à cheval sur le coucher devrait être mixte, elle '
        + 'rend ' + nbIr + '/12 en infrarouge — la bascule ne se fait pas image '
        + 'par image');
    } else {
      notes.push('boucle du soir : ' + (12 - nbIr) + ' images en couleurs puis '
        + nbIr + ' en infrarouge, la bascule tombe dans la bande');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 5. l'application DIT que l'image est infrarouge
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = path.join(APP, 'src', 'composants', 'CielRegional.js');
    if (!fs.existsSync(c)) {
      notes.push('CielRegional.js absent de cet arbre : contrôle non fait');
    } else {
      const t = fs.readFileSync(c, 'utf8');
      if (!/canal/.test(t) || !/infrarouge/i.test(t)) {
        fautes.push('CielRegional.js ne parle plus du canal : l’utilisateur qui '
          + 'ouvre Mata’i le soir verra une image grise sans savoir pourquoi, et '
          + 'conclura que l’application est cassée');
      } else if (!/mixte/.test(t)) {
        fautes.push('CielRegional.js ne traite pas le cas « mixte » : la bande du '
          + 'soir passe du couleur au gris sans un mot');
      } else {
        notes.push('l’application explique le canal, y compris la bande mixte du soir');
      }
    }
  }

  return { notes, fautes };
};
