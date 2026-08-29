/**
 * Le carnet de mesures par île : il s'accumule, il se coupe, et l'app l'ignore.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE.
 *
 * `build.mjs` écrit `paquets/mesures-iles.json` : un carnet des mesures par
 * île, passage après passage. Il sert à décider, dans quelques jours, si la
 * projection par île est publiable — donc il n'a de valeur que s'il
 * s'accumule vraiment d'un passage à l'autre, et il n'est sans danger que
 * si l'application ne le lit pas.
 *
 * Trois choses se cassent en silence si personne ne les surveille :
 *
 *   1. l'accumulation. `paquets/` est restauré depuis la branche « site »
 *      au début de chaque passage. Si l'écriture écrasait le carnet au lieu
 *      de le prolonger, on aurait toujours UN passage, et on ne s'en
 *      apercevrait qu'en allant lire le fichier — c'est-à-dire trop tard,
 *      après avoir cru collecter pendant trois jours.
 *
 *   2. la coupe. Sans plafond, le fichier grossit à chaque passage sur une
 *      branche que GitHub Pages sert entièrement. À vingt minutes le
 *      passage, cela fait soixante-douze entrées par jour, pour toujours.
 *
 *   3. les refus. Le carnet existe surtout pour eux : savoir QUE la mesure
 *      a échoué ne sert à rien, savoir POURQUOI décide de la suite. Un
 *      « nettoyage » qui ne garderait que les îles mesurées viderait le
 *      carnet de sa moitié utile.
 *
 * ⚠️  ET LA QUATRIÈME, LA PLUS IMPORTANTE.
 *
 * Ce carnet contient des refus, des dispersions et des désaccords — des
 * chiffres qui n'ont aucun sens pour quelqu'un qui veut savoir s'il peut
 * sortir en mer. Le jour où quelqu'un le branchera à l'application « parce
 * qu'il est déjà là et qu'il est frais », Mata'i affichera des flèches que
 * personne n'a jugées bonnes. C'est exactement ce que la projection
 * régionale a fait pendant toute son existence. Cet essai refuse ce
 * branchement.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const APP = path.resolve(RACINE, '..', 'matai-app');

module.exports = async function () {
  const fautes = [];
  const notes = [];

  const build = fs.readFileSync(path.join(RACINE, 'build.mjs'), 'utf8');

  // ═════════════════════════════════════════════════════════════════════
  // ── 1. le carnet est bien branché sur la mesure par île
  // ═════════════════════════════════════════════════════════════════════
  if (!/async function noterMesuresIles\s*\(/.test(build)) {
    fautes.push('build.mjs n’a plus de fonction `noterMesuresIles` — le carnet '
      + 'des mesures par île n’est plus écrit, et la décision de publier ou non '
      + 'la projection par île redevient une lecture de journaux qui ne se fera pas');
    return { notes, fautes };
  }
  if (!/await noterMesuresIles\s*\(/.test(build)) {
    fautes.push('`noterMesuresIles` est définie mais jamais appelée — le carnet '
      + 'restera vide en produisant zéro erreur');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 2. elle PROLONGE le carnet, elle ne l'écrase pas
  // ═════════════════════════════════════════════════════════════════════
  const corps = build.slice(build.indexOf('async function noterMesuresIles'),
                            build.indexOf('async function principal'));

  if (!/readFile\s*\(\s*chemin/.test(corps)) {
    fautes.push('`noterMesuresIles` n’essaie pas de relire le carnet existant : '
      + 'chaque passage l’écraserait, et après trois jours de collecte on '
      + 'trouverait UN passage au lieu de deux cents');
  }
  if (!/\.push\s*\(/.test(corps)) {
    fautes.push('`noterMesuresIles` ne pousse rien dans `passages` — elle ne '
      + 'peut pas accumuler');
  }
  if (!/slice\s*\(\s*-/.test(corps)) {
    fautes.push('`noterMesuresIles` ne coupe pas le carnet par la fin : le '
      + 'fichier grossira sans fin sur la branche « site », que GitHub Pages '
      + 'sert en entier');
  }
  const plafond = /const CARNET_MAX = (\d+)/.exec(build);
  if (!plafond) {
    fautes.push('CARNET_MAX a disparu — plus de plafond au carnet');
  } else if (Number(plafond[1]) > 500) {
    fautes.push('CARNET_MAX vaut ' + plafond[1] + ' : à 1,2 ko l’entrée, cela '
      + 'fait plus de 600 ko servis à chaque visiteur du site');
  } else {
    notes.push('carnet plafonné à ' + plafond[1] + ' passages');
  }

  // Une lecture ratée ne doit pas faire tomber le passage.
  if (!/catch/.test(corps)) {
    fautes.push('la relecture du carnet n’est pas protégée : un fichier abîmé '
      + 'ferait tomber un passage qui, lui, publie de la météo');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 3. les refus sont gardés
  // ═════════════════════════════════════════════════════════════════════
  if (!/m\.refus/.test(corps)) {
    fautes.push('le carnet ne consigne plus les refus — or c’est pour eux '
      + 'qu’il existe : savoir POURQUOI une île n’est pas mesurable décide '
      + 'de la suite, savoir QU’ELLE ne l’est pas ne décide de rien');
  } else {
    notes.push('les refus sont consignés, avec dispersion / désaccord / éclairement');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 4. ⚠️  L'APPLICATION NE LE LIT PAS
  // ═════════════════════════════════════════════════════════════════════
  const nom = /const CARNET_ILES = '([^']+)'/.exec(build);
  const fichier = nom ? nom[1] : 'mesures-iles.json';
  const souche = fichier.replace(/\.json$/, '');

  let lectures = [];
  const parcourir = (dossier) => {
    let entrees;
    try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
    catch { return; }
    for (const e of entrees) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dossier, e.name);
      if (e.isDirectory()) { parcourir(p); continue; }
      if (!/\.(js|jsx|ts|tsx)$/.test(e.name)) continue;
      const t = fs.readFileSync(p, 'utf8');
      if (t.includes(souche)) lectures.push(path.relative(APP, p));
    }
  };
  if (fs.existsSync(path.join(APP, 'src'))) {
    parcourir(path.join(APP, 'src'));
    if (lectures.length) {
      fautes.push('L’APPLICATION LIT LE CARNET (' + lectures.join(', ') + '). Ce '
        + 'fichier contient des refus, des dispersions et des désaccords — des '
        + 'chiffres que personne n’a jugés bons et qui n’ont aucun sens pour '
        + 'quelqu’un qui veut savoir s’il peut sortir en mer. C’est exactement '
        + 'ce qu’a fait la projection régionale pendant toute son existence. Si '
        + 'la mesure par île est prête à être publiée, écris-la ailleurs, '
        + 'explicitement, et retire ce garde-fou en connaissance de cause.');
    } else {
      notes.push('l’application ne lit pas « ' + fichier +' » — le carnet reste un carnet');
    }
  } else {
    notes.push('matai-app absent de cet arbre : le contrôle « l’app ne le lit pas » '
      + 'n’a pas pu être fait');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 5. et l'accumulation, pour de vrai, sur disque
  // ═════════════════════════════════════════════════════════════════════
  {
    const os = require('os');
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'matai-carnet-'));
    const chemin = path.join(dossier, fichier);
    try {
      // On rejoue la logique du carnet telle qu'elle est écrite, en petit :
      // trois passages successifs, dont un sur un fichier abîmé.
      const MAX = 3;
      const noter = (entree) => {
        let carnet = { version: 1, passages: [] };
        try {
          const a = JSON.parse(fs.readFileSync(chemin, 'utf8'));
          if (Array.isArray(a.passages)) carnet = a;
        } catch { /* rien */ }
        carnet.passages.push(entree);
        if (carnet.passages.length > MAX) carnet.passages = carnet.passages.slice(-MAX);
        fs.writeFileSync(chemin, JSON.stringify(carnet));
        return carnet;
      };

      noter({ n: 1 }); noter({ n: 2 });
      const c3 = noter({ n: 3 });
      if (c3.passages.length !== 3) {
        fautes.push('trois passages devraient donner trois entrées, on en a '
          + c3.passages.length);
      }
      const c4 = noter({ n: 4 });
      if (c4.passages.length !== MAX || c4.passages[0].n !== 2) {
        fautes.push('la coupe ne garde pas les plus RÉCENTS : '
          + JSON.stringify(c4.passages));
      }

      fs.writeFileSync(chemin, '{ ceci n’est pas du json');
      const c5 = noter({ n: 5 });
      if (c5.passages.length !== 1) {
        fautes.push('un carnet abîmé devrait repartir à un passage, pas jeter '
          + 'une erreur ni rendre ' + c5.passages.length);
      } else {
        notes.push('accumulation vérifiée sur disque : prolonge, coupe par la '
          + 'fin, et repart proprement d’un fichier abîmé');
      }
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  }

  return { notes, fautes };
};
