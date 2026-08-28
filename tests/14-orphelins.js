/**
 * Tout ce qui est dans `src/` doit être atteignable depuis `App.js`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  LE DÉFAUT QUE CE FICHIER EXISTE POUR EMPÊCHER : LE CODE ÉCRIT,
 *     VÉRIFIÉ, ET QUE PLUS RIEN N'APPELLE.
 *
 * C'est arrivé deux fois en deux heures, sur la même chose.
 *
 *   1. La carte de l'île vivait sur un onglet CARTE. Quand les six onglets
 *      ont été posés, CARTE a été remplacé par CIEL. L'écran est resté
 *      dans le dossier, son import est resté dans `App.js`, et plus rien
 *      ne le rendait. Le trait de côte tiré d'OpenStreetMap, les récifs
 *      barrière relevés île par île, les points de mesure à leurs vraies
 *      coordonnées : tout ça est devenu inatteignable.
 *
 *   2. Remise dans CIEL, elle s'est retrouvée après un retour anticipé
 *      « pas encore d'images » — donc invisible hors ligne, c'est-à-dire
 *      au premier lancement.
 *
 * Aucun banc ne s'en est plaint, et c'est le point : un test vérifie ce
 * qu'il VOIT. Il ne peut pas se plaindre d'un écran qui n'est plus rendu,
 * parce qu'il ne va jamais le chercher. Un banc de navigateur est aveugle
 * exactement là où il faudrait qu'il regarde.
 *
 * Ce test-ci ne regarde pas l'écran : il suit les `import` depuis `App.js`
 * et compte ce qu'il n'a pas atteint. C'est bête, c'est statique, et c'est
 * la seule chose qui puisse dire « ce fichier ne sert plus à rien » — donc
 * « quelqu'un a peut-être perdu une fonctionnalité sans s'en apercevoir ».
 *
 * Il a trouvé `src/ecrans/Carte.js` du premier coup : l'écran de l'étape 1,
 * resté sur le disque après que son contenu a été déplacé dans `Ciel.js`.
 * Il a été supprimé — un écran mort est précisément le piège dans lequel
 * la carte est déjà tombée.
 *
 * ⚠️  UN ORPHELIN N'EST PAS FORCÉMENT UNE FAUTE.
 *
 * Un module peut être légitimement en attente. Dans ce cas on l'inscrit
 * ci-dessous AVEC SA RAISON — l'inscription est le geste qui oblige à se
 * poser la question, et la liste vide est le cas normal.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { APP, aLApp } = require('./harnais');

/**
 * Les orphelins tolérés, et pourquoi. Vide : c'est l'état sain.
 * Format : 'chemin/relatif/a/src.js': 'la raison, en une phrase'
 */
const TOLERES = {};

/** Résout un import relatif vers un fichier réel, comme le fait Metro. */
function resoudre(depuis, spec) {
  if (!spec.startsWith('.')) return null;
  const p = path.resolve(path.dirname(depuis), spec);
  for (const c of [p, p + '.js', p + '.jsx', path.join(p, 'index.js')]) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch (e) { /* pas celui-là */ }
  }
  return null;
}

/** Tous les .js sous un dossier. */
function tousLesFichiers(racine) {
  const out = [];
  const pile = [racine];
  while (pile.length) {
    const d = pile.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) pile.push(p);
      else if (/\.jsx?$/.test(e.name)) out.push(p);
    }
  }
  return out;
}

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const racine = path.resolve(APP, '..');       // APP pointe sur src/
  const entree = path.join(racine, 'App.js');
  if (!fs.existsSync(entree)) return { saute: 'App.js introuvable' };

  const fautes = [];
  const notes = [];

  // ── on suit les imports depuis App.js, en largeur
  const atteints = new Set();
  const pile = [entree];
  const importsCasses = [];

  while (pile.length) {
    const f = pile.pop();
    if (atteints.has(f)) continue;
    atteints.add(f);

    const source = fs.readFileSync(f, 'utf8');
    for (const m of source.matchAll(/(?:from|import|require\()\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;      // un paquet npm : pas notre affaire
      const r = resoudre(f, spec);
      if (!r) {
        // ⚠️  Un import relatif qui ne résout pas est une erreur au
        // lancement, pas un détail : Metro échoue, l'application ne démarre
        // pas. Autant le dire ici, où c'est instantané.
        importsCasses.push(path.relative(racine, f) + ' → « ' + spec + ' »');
        continue;
      }
      pile.push(r);
    }
  }

  for (const c of importsCasses) fautes.push('import relatif introuvable : ' + c);

  // ── ce qui existe et n'a pas été atteint
  const tous = tousLesFichiers(APP);
  const orphelins = tous
    .map((f) => path.relative(APP, f).split(path.sep).join('/'))
    .filter((rel) => !atteints.has(path.join(APP, rel)))
    .sort();

  for (const rel of orphelins) {
    if (TOLERES[rel]) { notes.push('toléré — ' + rel + ' : ' + TOLERES[rel]); continue; }
    fautes.push('src/' + rel + ' n’est atteint par aucun import depuis App.js — '
      + 'code mort, ou fonctionnalité débranchée sans qu’on s’en aperçoive');
  }

  // ── un toléré qui a été rebranché doit sortir de la liste
  for (const rel of Object.keys(TOLERES)) {
    if (!orphelins.includes(rel)) {
      fautes.push('src/' + rel + ' est de nouveau atteint : le retirer de TOLERES');
    }
  }

  notes.push(atteints.size + ' fichiers atteints depuis App.js, '
    + tous.length + ' présents sous src/');
  notes.push(orphelins.length === 0
    ? 'aucun orphelin'
    : orphelins.length + ' orphelin(s)');

  return { notes, fautes };
};
