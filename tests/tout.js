#!/usr/bin/env node
/**
 * Mata'i — lance tout le banc d'essai.
 *
 *     npm test                    tout ce qui peut tourner ici
 *     MATAI_APP=… npm test        en désignant les sources de l'app
 *     node tests/tout.js 03       un seul test, par son numéro
 *
 * Chaque test est un module qui exporte une fonction et renvoie
 * `{ notes, fautes }` — ou `{ saute: 'raison' }` quand il lui manque de quoi
 * travailler. Une faute fait sortir en échec ; une note est là pour être lue.
 *
 * ⚠️  LA FONCTION PEUT ÊTRE ASYNCHRONE, ET LE LANCEUR L'ATTEND.
 *
 * Ça n'a l'air de rien. Ça a pourtant laissé passer deux tests entiers.
 * `10-mesures` et `11-fraicheur` chargent des modules ESM par `import()`,
 * donc ils sont `async`, donc ils renvoient une promesse. Le lanceur lisait
 * `r.fautes` sur cette promesse : `undefined`, zéro faute, ✓ vert. Deux
 * tests qui ne vérifiaient RIEN et qui l'annonçaient en vert.
 *
 * Repéré parce qu'ils n'affichaient aucune note — le seul signe visible.
 * D'où le garde-fou plus bas : un test dont le résultat n'est ni un objet
 * exploitable ni une promesse résolue est compté comme un ÉCHEC, jamais
 * comme un succès. Un banc qui se trompe en vert est pire qu'un banc absent.
 *
 * Pourquoi pas un cadre de test tout fait : ce banc doit tourner sur une
 * machine à Bora Bora avec une connexion qui coupe, dans un dépôt qui a une
 * seule dépendance. Trois cents lignes qu'on peut lire en entier valent mieux
 * qu'un outil qu'on ne peut pas réparer soi-même.
 */

const fs = require('fs');
const path = require('path');

const filtre = process.argv[2] || null;

const fichiers = fs.readdirSync(__dirname)
  .filter((f) => /^\d\d-.*\.js$/.test(f))
  .filter((f) => !filtre || f.startsWith(filtre))
  .sort();

if (fichiers.length === 0) {
  console.log('aucun test à lancer' + (filtre ? ' pour « ' + filtre + ' »' : ''));
  process.exit(1);
}

let echecs = 0, sautes = 0, passes = 0;
const debut = Date.now();

(async () => {
console.log('');
for (const f of fichiers) {
  const nom = f.replace(/^\d\d-/, '').replace(/\.js$/, '');
  process.stdout.write('  ' + nom.padEnd(12) + ' ');

  let r;
  const t0 = Date.now();
  try {
    r = require(path.join(__dirname, f))();
    // Un test peut être asynchrone : on l'attend. Sans ce `await`, on lit
    // `.fautes` sur une promesse — toujours `undefined`, donc toujours vert.
    if (r && typeof r.then === 'function') r = await r;
  } catch (e) {
    echecs++;
    console.log('✗  le test lui-même a planté');
    console.log('      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e));
    continue;
  }
  const ms = Date.now() - t0;

  if (r && r.saute) {
    sautes++;
    console.log('–  sauté : ' + r.saute);
    continue;
  }

  // ⚠️  Un test doit rendre un objet exploitable. S'il rend autre chose —
  // une promesse non résolue, `undefined`, un nombre — on ne sait pas ce
  // qu'il a vérifié, et on ne le compte SURTOUT PAS comme réussi.
  if (!r || typeof r !== 'object' || (!Array.isArray(r.fautes) && !r.notes)) {
    echecs++;
    console.log('✗  le test n’a rien rendu d’exploitable ('
      + (r === undefined ? 'undefined' : typeof r) + ')');
    continue;
  }

  const fautes = (r && r.fautes) || [];
  if (fautes.length === 0) {
    passes++;
    console.log('✓  ' + (ms > 200 ? ms + ' ms' : ''));
  } else {
    echecs++;
    console.log('✗  ' + fautes.length + ' faute(s)');
  }

  for (const n of (r && r.notes) || []) console.log('      · ' + n);
  for (const x of fautes) console.log('      ✗ ' + x);
}

const duree = ((Date.now() - debut) / 1000).toFixed(1);
console.log('');
console.log('  ' + passes + ' réussi(s), ' + echecs + ' en échec, ' + sautes + ' sauté(s) — ' + duree + ' s');
console.log('');

process.exit(echecs === 0 ? 0 : 1);
})();
