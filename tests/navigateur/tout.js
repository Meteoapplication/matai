/**
 * Mata'i — le banc du navigateur, en une commande.
 *
 *     node tests/navigateur/tout.js
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Il fait tout ce qu'il faut et le défait ensuite :
 *
 *   1. exporte l'application pour le web ;
 *   2. la sert sur un port libre — avec un serveur écrit ici, en Node, pour
 *      ne dépendre ni de Python ni de rien d'installé (ce projet se
 *      développe sous Windows) ;
 *   3. lance les cinq essais dans l'ordre du plus court au plus long ;
 *   4. arrête le serveur, et sort en échec si l'un d'eux a échoué.
 *
 * Sans ça, le banc du navigateur demande quatre commandes et un serveur à la
 * main. Un essai qu'on n'a pas envie de lancer ne sert à rien.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Options :
 *   --sans-export   réutilise l'export précédent (gagne ≈ 90 s)
 *   --seul=nom      ne lance qu'un essai (horloges, etroit, satellite, abime, iles)
 */

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RACINE = path.resolve(__dirname, '..', '..');
const APP = process.env.MATAI_APP_DIR || path.resolve(RACINE, '..', 'matai-app');
const SORTIE = process.env.MATAI_EXPORT || path.join(os.tmpdir(), 'matai-web');

const args = process.argv.slice(2);
const sansExport = args.includes('--sans-export');
const seul = (args.find((a) => a.startsWith('--seul=')) || '').split('=')[1];

const ESSAIS = [
  { nom: 'horloges',  dit: '7 heures de la journée, hors ligne' },
  { nom: 'etroit',    dit: '4 largeurs d’écran' },
  { nom: 'satellite', dit: 'observé et projeté ne se mélangent pas' },
  // Le nombre de cas est compté par l'essai lui-même : l'écrire ici l'a
  // laissé à « 10 » alors qu'il y en avait 18.
  { nom: 'abime',     dit: 'paquets abîmés' },
  { nom: 'iles',      dit: 'les 9 îles' }
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json'
};

/** Un serveur de fichiers minimal — aucune dépendance, marche sous Windows. */
function servir(racine) {
  return new Promise((resolve) => {
    const s = http.createServer((req, rep) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '') p = '/index.html';
      const sur = path.join(racine, p);
      // Ne jamais sortir du dossier servi.
      if (!sur.startsWith(racine)) { rep.writeHead(403).end('non'); return; }
      fs.readFile(sur, (e, buf) => {
        if (e) {
          // Une application à écran unique renvoie index.html sur l'inconnu.
          return fs.readFile(path.join(racine, 'index.html'), (e2, idx) => {
            if (e2) { rep.writeHead(404).end('absent'); return; }
            rep.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(idx);
          });
        }
        rep.writeHead(200, { 'Content-Type': TYPES[path.extname(sur)] || 'application/octet-stream' })
           .end(buf);
      });
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

(async () => {
  if (!fs.existsSync(APP)) {
    console.error('Application introuvable : ' + APP
      + '\n(MATAI_APP_DIR pour la désigner autrement)');
    process.exit(2);
  }

  if (!sansExport) {
    console.log('▸ export web de l’application (≈ 90 s)…');
    const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', SORTIE],
      { cwd: APP, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
    if (r.status !== 0) { console.error('L’export a échoué.'); process.exit(2); }
  }
  if (!fs.existsSync(path.join(SORTIE, 'index.html'))) {
    console.error('Aucun export dans ' + SORTIE + ' — relancer sans --sans-export.');
    process.exit(2);
  }

  // ⚠️  « --sans-export » gagne quatre-vingt-dix secondes et peut en coûter
  // beaucoup plus : il fait tourner tout le banc sur le code d'avant, au
  // vert, sans rien dire. On refuse plutôt que d'aller vite. (Le détail est
  // écrit en tête de `pw.js`, à l'endroit où ça s'est produit.)
  if (sansExport) {
    const retard = require('./pw').exportEnRetard();
    if (retard) { console.error(retard); process.exit(2); }
  }

  const { s, port } = await servir(SORTIE);
  const url = 'http://127.0.0.1:' + port + '/';
  console.log('▸ servie sur ' + url + '\n');

  // ⚠️  PAS spawnSync ICI. Le serveur tourne dans CE processus : un
  // spawnSync bloque la boucle d'événements, donc le serveur ne répond plus
  // à une seule requête tant que l'essai tourne. Symptôme : chaque essai
  // meurt sur « page.goto: Timeout 30000ms » alors que le serveur est
  // parfaitement sain et répond en curl. Une demi-heure pour le voir.
  const lancer = (fichier) => new Promise((resolve) => {
    const p = spawn(process.execPath, [fichier], {
      stdio: 'inherit',
      env: { ...process.env, MATAI_URL: url }
    });
    p.on('close', (code) => resolve(code));
  });

  const bilan = [];
  for (const e of ESSAIS) {
    if (seul && seul !== e.nom) continue;
    console.log('\n════════ ' + e.nom + ' — ' + e.dit + ' ════════');
    const code = await lancer(path.join(__dirname, e.nom + '.js'));
    bilan.push({ nom: e.nom, ok: code === 0 });
  }

  s.close();

  console.log('\n════════ bilan ════════');
  for (const b of bilan) console.log('  ' + (b.ok ? '✓' : '✗') + '  ' + b.nom);
  const rates = bilan.filter((b) => !b.ok).length;
  console.log('\n' + (bilan.length - rates) + ' réussi(s), ' + rates + ' en échec');
  process.exit(rates ? 1 : 0);
})();
