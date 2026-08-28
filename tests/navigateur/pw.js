/**
 * Trouver Playwright, ou expliquer clairement ce qui manque.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Playwright n'est PAS une dépendance de ce projet. Il ne sert qu'ici, il
 * pèse un navigateur entier, et `npm install` doit rester léger pour la
 * publication automatique — GitHub Actions installe ce dossier vingt-quatre
 * fois par jour.
 *
 * Il est donc facultatif, et son absence doit se lire comme une consigne,
 * pas comme une pile d'appels. Sans ce fichier, lancer le banc du navigateur
 * sur une machine neuve donne :
 *
 *     Error: Cannot find module 'playwright'
 *         at Function._resolveFilename (node:internal/modules/cjs/loader…)
 *         … quinze lignes …
 *
 * — ce qui est vrai, illisible, et ne dit pas quoi taper.
 * ═══════════════════════════════════════════════════════════════════════
 */

const CONSIGNE = `
  Playwright n’est pas installé — il est facultatif et ne sert qu’au banc
  du navigateur (« npm install » doit rester léger : la publication
  automatique l’exécute vingt-quatre fois par jour).

  Pour l’installer, depuis matai-backend/ :

      npm install --no-save playwright
      npx playwright install chromium

  La seconde ligne télécharge le navigateur lui-même (≈ 150 Mo), une fois.

  Si Playwright est déjà quelque part sur la machine, on peut le désigner
  sans rien installer :

      PLAYWRIGHT=/chemin/vers/node_modules/playwright   (le module)
      CHROMIUM=/chemin/vers/chromium                    (le navigateur)
`;

function chromium() {
  const chemin = process.env.PLAYWRIGHT || 'playwright';
  let mod;
  try {
    mod = require(chemin);
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') {
      console.error(CONSIGNE);
      process.exit(2);
    }
    throw e;
  }
  if (!mod || !mod.chromium) {
    console.error('\n  « ' + chemin + ' » a été trouvé mais n’expose pas chromium.\n' + CONSIGNE);
    process.exit(2);
  }
  return mod.chromium;
}

/** Les options de lancement : un Chromium désigné à la main, ou celui de Playwright. */
function options() {
  return process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
}

/**
 * ⚠️  UN BANC QUI ÉPROUVE UN EXPORT PÉRIMÉ NE PROUVE RIEN.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Ce banc ne lit pas les sources : il lit une page servie, donc un EXPORT.
 * Entre les deux il y a une commande d'une minute et demie, et quand on ne
 * la relance pas, l'essai continue de tourner — au vert — sur le code
 * d'avant.
 *
 * Ce n'est pas une hypothèse. Le garde-fou qui vérifie que la carte de
 * l'île est bien rendue a été éprouvé en retirant la carte de `Ciel.js` :
 * l'essai est resté vert. Pas parce que le garde-fou était faux — il est
 * juste — mais parce que le navigateur regardait un export vieux de six
 * minutes, où la carte était encore là. Sans l'avoir remarqué, on aurait
 * classé « garde-fou vérifié » un garde-fou jamais mis à l'épreuve, et
 * gardé cette fausse assurance dans le seul endroit du projet qui existe
 * pour ne pas en avoir.
 *
 * C'est la faute la plus coûteuse qu'un banc puisse commettre : le vert
 * qui ne veut rien dire est pire que le rouge, parce qu'on s'y repose.
 *
 * Donc, quand le banc sert l'export par défaut, il compare l'âge des
 * sources à celui de l'export et refuse de partir si l'export est en
 * retard. Quand `MATAI_URL` est posé à la main, l'opérateur a choisi ce
 * qu'il sert : on se tait.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Le plus récent `mtime` sous un dossier, en descendant. 0 s'il n'existe pas. */
function plusRecent(racine, garder) {
  let max = 0;
  const pile = [racine];
  while (pile.length) {
    const d = pile.pop();
    let entrees;
    try {
      entrees = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of entrees) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { pile.push(p); continue; }
      if (garder && !garder(e.name)) continue;
      try {
        const t = fs.statSync(p).mtimeMs;
        if (t > max) max = t;
      } catch (e2) { /* fichier disparu entre-temps */ }
    }
  }
  return max;
}

/**
 * Refuse de lancer un essai sur un export plus vieux que les sources.
 *
 * @returns null si tout va bien, sinon la phrase à afficher.
 */
function exportEnRetard() {
  const app = process.env.MATAI_APP_DIR
    || path.resolve(__dirname, '..', '..', '..', 'matai-app');
  const sortie = process.env.MATAI_EXPORT || path.join(os.tmpdir(), 'matai-web');

  const tExport = plusRecent(path.join(sortie, '_expo'));
  if (!tExport) return null;   // pas d'export ici : rien à comparer, on se tait

  const tSources = Math.max(
    plusRecent(path.join(app, 'src'), (n) => /\.(js|jsx|json)$/.test(n)),
    plusRecent(path.join(app, 'composants'), (n) => /\.(js|jsx)$/.test(n)),
    ...['App.js', 'app.json', 'package.json'].map((f) => {
      try { return fs.statSync(path.join(app, f)).mtimeMs; } catch (e) { return 0; }
    })
  );
  if (!tSources || tSources <= tExport) return null;

  const minutes = Math.round((tSources - tExport) / 60000);
  return '\n  ⚠️  L’export web est plus vieux que les sources'
    + ' (' + (minutes < 1 ? 'moins d’une minute' : minutes + ' minutes') + ' de retard).'
    + '\n'
    + '\n  Cet essai lit une page servie, pas les fichiers du projet : il'
    + '\n  éprouverait le code d’avant et rendrait un vert qui ne prouve rien.'
    + '\n'
    + '\n  Réexporter :'
    + '\n'
    + '\n      cd ' + app
    + '\n      npx expo export --platform web --output-dir ' + sortie
    + '\n'
    + '\n  (« node tests/navigateur/tout.js » le fait tout seul.)'
    + '\n  Pour servir un autre export volontairement, poser MATAI_URL.\n';
}

/**
 * Lance le navigateur, en expliquant aussi le second manque possible : le
 * module est là mais le navigateur n'a jamais été téléchargé.
 */
async function lancer() {
  if (!process.env.MATAI_URL && !process.env.MATAI_EXPORT_VERIFIE) {
    const retard = exportEnRetard();
    if (retard) { console.error(retard); process.exit(2); }
  }
  try {
    return await chromium().launch(options());
  } catch (e) {
    const m = String(e && e.message);
    if (/Executable doesn.t exist|playwright install/i.test(m)) {
      console.error('\n  Playwright est installé, mais pas le navigateur.\n'
        + '\n      npx playwright install chromium\n');
      process.exit(2);
    }
    throw e;
  }
}

module.exports = { chromium, options, lancer, exportEnRetard };
