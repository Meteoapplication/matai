/**
 * Ce qu'on embarque dans l'application, et qu'on ne regardera jamais.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUATRE MÉGAOCTETS ET DEMI DE POLICES INUTILES.
 *
 * En exportant pour de bon le bundle Android — `npx expo export --platform
 * android`, ce qui n'avait jamais été fait — l'application embarquait
 * TRENTE-DEUX fichiers de police pour QUATRE réellement affichées :
 *
 *     avant : 32 ressources, 4,77 Mo  +  bundle 2,42 Mo  =  7,18 Mo
 *     après :  4 ressources, 0,64 Mo  +  bundle 2,40 Mo  =  3,04 Mo
 *
 * La cause : `import { X } from '@expo-google-fonts/spectral'` passe par
 * l'index du paquet, qui réexporte toutes les graisses. Metro suit le graphe
 * et les embarque toutes — ExtraLight, Black, tous les italiques. L'import
 * par chemin de fichier ne tire que ce qu'on nomme.
 *
 * Ça n'est pas une optimisation de confort. Ce projet écrit « économie de
 * données » dans ses commentaires et vise des gens sur un forfait polynésien
 * ou une connexion d'atoll : on ne peut pas soutenir les deux à la fois.
 *
 * Ce test relit les imports plutôt que de reconstruire le bundle : un export
 * Expo prend une minute et demie et demande tout node_modules, ce qui n'a pas
 * sa place à chaque publication. Il attrape la régression exacte — quelqu'un
 * qui réécrit un import « à la manière documentée » sans savoir ce qu'elle
 * coûte.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { APP, aLApp, sansCommentaires } = require('./harnais');

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  // App.js est à côté de src/, pas dedans.
  const racine = path.resolve(APP, '..');
  const fautes = [];
  const notes = [];

  const aLire = [];
  (function marche(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) marche(p);
      else if (e.name.endsWith('.js')) aLire.push(p);
    }
  })(racine);

  let imports = 0;
  for (const f of aLire) {
    // Sans ce retrait, le gros commentaire qui explique CE défaut serait
    // lui-même signalé comme le défaut. Vu au premier passage.
    const code = sansCommentaires(fs.readFileSync(f, 'utf8'));
    const court = path.relative(racine, f);

    // Toutes les provenances importées du fichier.
    const re = /from\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const source = m[1];
      imports++;

      // ⚠️  L'index d'un paquet de polices Google tire TOUTES les graisses.
      if (/^@expo-google-fonts\/[^/]+$/.test(source)) {
        fautes.push(court + ' : « ' + source + ' » importe l’index du paquet —'
          + ' toutes les graisses seront embarquées.'
          + ' Importer chaque police par son fichier :'
          + ' from \'' + source + '/NomDeLaPolice.ttf\'');
      }
    }
  }

  // Combien de polices sont réellement demandées ? C'est ce nombre qui doit
  // se retrouver dans le bundle, et rien de plus.
  const app = path.join(racine, 'App.js');
  let demandees = 0;
  if (fs.existsSync(app)) {
    const code = sansCommentaires(fs.readFileSync(app, 'utf8'));
    demandees = (code.match(/@expo-google-fonts\/[^/'"]+\/[^'"]+\.ttf/g) || []).length;
  }
  notes.push(imports + ' imports relus, ' + demandees + ' police(s) embarquée(s) par leur fichier');
  notes.push('bundle Android mesuré le 27 août : 3,04 Mo (7,18 Mo avant cette correction)');

  return { notes, fautes };
};
