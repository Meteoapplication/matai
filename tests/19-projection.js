/**
 * Le point 6 n'a jamais été publié, et tout était vert.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * La projection à une heure — la seconde moitié de ce que l'associé
 * demandait pour l'écran satellite — n'a JAMAIS été publiée une seule fois
 * en production. Pas une panne : une ligne de journal.
 *
 *     projection : étape abandonnée — Input file is missing:
 *       …/paquets/nuages/anim/nuages/anim/20262400220.jpg
 *
 * Le chemin est doublé. `animation.mjs` écrit dans son index un chemin
 * relatif à `paquets/` — « nuages/anim/xxx.jpg » — parce que c'est
 * l'application qui le consomme et le colle derrière l'adresse du site.
 * `projection.mjs` prenait ce champ pour un nom de fichier nu et le
 * recollait derrière le dossier source.
 *
 * ⚠️  POURQUOI AUCUN BANC NE POUVAIT LE VOIR.
 *
 * Les essais fabriquaient leur index avec des noms nus — parce que c'est
 * ce que le code attendait. Le banc éprouvait donc l'accord du code avec
 * lui-même, jamais son accord avec `animation.mjs`. Les deux modules se
 * parlaient dans deux dialectes, et chacun était cohérent tout seul.
 *
 * Et l'erreur était rattrapée : `build.mjs` entoure la projection d'un
 * try/catch, volontairement — un satellite qui tombe ne doit pas arrêter
 * les prévisions. Le passage restait donc vert, l'écran affichait
 * poliment « pas encore de projection », rien n'était faux. La
 * fonctionnalité n'existait simplement pas.
 *
 * D'où ce fichier : il éprouve la lecture de l'index contre la forme
 * RÉELLEMENT écrite par `animation.mjs`, pas contre celle qui arrangeait
 * le lecteur.
 * ═══════════════════════════════════════════════════════════════════════
 */

const path = require('path');

/** L'index tel qu'`animation.mjs` l'écrit vraiment — relevé en production. */
const INDEX_REEL = {
  images: [
    { fichier: 'nuages/anim/20262400110.jpg', t: '2026-08-28T01:10:00.000Z' },
    { fichier: 'nuages/anim/20262400220.jpg', t: '2026-08-28T02:20:00.000Z' },
    { fichier: 'nuages/anim/20262400300.jpg', t: '2026-08-28T03:00:00.000Z' }
  ]
};

module.exports = async function () {
  const P = await import(
    'file://' + path.resolve(__dirname, '..', 'projection.mjs')
  );

  const fautes = [];
  const notes = [];

  if (typeof P.nomsDepuisIndex !== 'function') {
    fautes.push('projection.mjs n’expose plus « nomsDepuisIndex » : la lecture '
      + 'de l’index n’est plus éprouvable, c’est elle qui avait cassé');
    return { notes, fautes };
  }

  // ── la forme réelle : des chemins, pas des noms
  const noms = P.nomsDepuisIndex(INDEX_REEL);
  if (noms.length !== 3) {
    fautes.push('3 images dans l’index, ' + noms.length + ' nom(s) rendus');
  }
  for (const n of noms) {
    if (n.includes('/') || n.includes('\\')) {
      fautes.push('« ' + n + ' » contient encore un séparateur de chemin — '
        + 'recollé derrière le dossier source, il donnera un chemin doublé '
        + 'et sharp refusera le fichier');
    }
    if (!/^\d+\.jpg$/.test(n)) {
      fautes.push('« ' + n + ' » n’est pas un nom de fichier attendu');
    }
  }
  notes.push('index de production lu : ' + noms.join(', '));

  // ── les autres formes acceptées ne doivent pas régresser
  const CAS = [
    ['noms nus',            { images: ['20262400110.jpg', '20262400220.jpg'] }, 2],
    ['horodatages sans .jpg', { images: [{ horodatage: '20262400110' }] },      1],
    ['chemins Windows',     { images: [{ fichier: 'nuages\\anim\\20262400110.jpg' }] }, 1],
    ['index vide',          { images: [] },                                     0],
    ['index absent',        null,                                               0],
    ['images non tableau',  { images: 'oui' },                                  0],
    ['entrées abîmées',     { images: [null, {}, { fichier: '' }, '20262400110'] }, 1]
  ];
  for (const [quoi, idx, attendu] of CAS) {
    let r;
    try {
      r = P.nomsDepuisIndex(idx);
    } catch (e) {
      fautes.push(quoi + ' : la lecture a planté — ' + e.message);
      continue;
    }
    if (r.length !== attendu) {
      fautes.push(quoi + ' : ' + r.length + ' nom(s) au lieu de ' + attendu
        + ' — ' + JSON.stringify(r));
    }
    for (const n of r) {
      if (n.includes('/') || n.includes('\\')) {
        fautes.push(quoi + ' : « ' + n + ' » garde un séparateur de chemin');
      }
    }
  }
  notes.push(CAS.length + ' formes d’index éprouvées, dont Windows et les entrées abîmées');

  // ── l'ordre chronologique est celui du calcul de déplacement
  const desordre = P.nomsDepuisIndex({
    images: [
      { fichier: 'nuages/anim/20262400300.jpg' },
      { fichier: 'nuages/anim/20262400110.jpg' },
      { fichier: 'nuages/anim/20262400220.jpg' }
    ]
  });
  if (desordre.join(',') !== '20262400110.jpg,20262400220.jpg,20262400300.jpg') {
    fautes.push('les images ne sont pas remises en ordre chronologique : '
      + desordre.join(', ') + ' — le déplacement serait calculé à l’envers');
  }
  notes.push('les images sont remises dans l’ordre du temps');

  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️  UN DÉPLACEMENT NUL DOIT ÊTRE REFUSÉ.
  //
  // Au premier passage où la projection a enfin tourné, la mesure a rendu
  // dx = dy = dispersion = 0 sur cinq paires. Or le vent était de
  // 16,5 nœuds et l'image fait 2 km par pixel : un nuage parcourt 2,5
  // pixels en dix minutes, largement au-dessus du plancher de ce calcul.
  //
  // Cinq paires donnant toutes exactement zéro, ce n'est pas un ciel
  // immobile — une vraie mesure bruite. C'est une corrélation muette.
  //
  // Et avec un déplacement nul, les images « projetées » sont des copies de
  // la dernière image observée : on publierait une photo du passé sous un
  // bandeau « PROJECTION · +60 min ». Le point 8 du cahier des charges
  // l'interdit, et l'écran sait déjà dire « pas de projection ».
  // ═══════════════════════════════════════════════════════════════════════
  const REFUS = [
    ['déplacement nul partout',   { dxs: [0, 0, 0, 0, 0], dys: [0, 0, 0, 0, 0] }, true],
    ['nul mais bruité',           { dxs: [0, 1, 0, -1, 0], dys: [0, 0, 1, 0, 0] }, false],
    ['déplacement franc',         { dxs: [2, 3, 2, 3, 2], dys: [1, 1, 2, 1, 1] }, false]
  ];

  // On rejoue la règle de décision sans images ni sharp : c'est elle qu'on
  // éprouve, pas la corrélation.
  const mediane = (t) => { const s = [...t].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const regle = ({ dxs, dys }) => {
    const dx = mediane(dxs), dy = mediane(dys);
    const dispersion = Math.max(
      Math.max(...dxs) - Math.min(...dxs),
      Math.max(...dys) - Math.min(...dys));
    return dx === 0 && dy === 0 && dispersion === 0;
  };

  for (const [quoi, ech, attendu] of REFUS) {
    if (regle(ech) !== attendu) {
      fautes.push(quoi + ' : refusé=' + regle(ech) + ' au lieu de ' + attendu);
    }
  }

  // Et la règle doit bien être DANS le module, pas seulement dans ce test.
  const fs = require('fs');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'projection.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (!/dxBase === 0 && dyBase === 0 && dispersion === 0/.test(src)) {
    fautes.push('projection.mjs ne refuse plus un déplacement nul : il publierait '
      + 'des copies de la dernière image observée sous un bandeau « PROJECTION »');
  }
  notes.push('un déplacement nul sur toutes les paires est refusé, un déplacement bruité passe');

  return { notes, fautes };
};
