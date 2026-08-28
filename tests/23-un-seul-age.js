/**
 * Une seule façon de dire un âge, dans toute l'application.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  DEUX ÉTIQUETTES SE CONTREDISAIENT SUR LE MÊME ÉCRAN.
 *
 * Relevé sur téléphone le 28 août 2026, écran d'accueil, une seule capture :
 *
 *     carte du ciel .... « il y a 2 heures »
 *     bandeau du bas ... « il y a 1 heure »
 *
 * Même donnée, même instant, deux réponses. Il y avait TROIS fonctions pour
 * dire un âge, et elles n'arrondissaient pas pareil :
 *
 *     donnees.js / fraicheur()      Math.round(min / 60)
 *     provenance.js / direAge()     Math.floor(min / 60) + les minutes
 *     composants/Fraicheur.js /     Math.floor(min / 60) + les minutes
 *       depuis()                    (mais « min » au lieu de « minutes »)
 *
 *     âge réel   arrondi           plancher
 *      89 min    il y a 1 heure    il y a 1 h 29
 *      91 min    il y a 2 heures   il y a 1 h 31   ← se contredisent
 *     151 min    il y a 3 heures   il y a 2 h 31   ← se contredisent
 *
 * Deux minutes d'écart font sauter l'étiquette d'une heure entière.
 *
 * ⚠️  ET CE N'EST PAS UN DÉTAIL DE PRÉSENTATION.
 *
 * Tout l'argument de Mata'i tient en une phrase : « je te dis l'âge réel de
 * la donnée, pas une fraîcheur supposée ». C'est ce qui la distingue des
 * outils qui affichent « mis à jour à l'instant » en servant un fichier de
 * la veille. Deux réponses différentes au même instant abîment exactement
 * ce qu'on essaie de construire — et ça se voit d'un seul coup d'œil, sans
 * rien connaître au projet.
 *
 * Ce fichier impose deux choses : que les trois fonctions rendent le MÊME
 * texte pour le MÊME âge, et qu'il n'existe plus qu'un seul endroit où la
 * règle est écrite.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { charger, aLApp, sansCommentaires, APP } = require('./harnais');

/** Les âges éprouvés, en minutes. Les deux derniers sont ceux qui divergeaient. */
const AGES = [0, 1, 5, 30, 59, 60, 61, 89, 90, 91, 120, 149, 150, 151, 359, 719];

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const fautes = [];
  const notes = [];

  const prov = charger('provenance');
  const don = charger('donnees');
  const frch = charger('composants/Fraicheur');

  for (const [nom, f] of [['provenance.direAge', prov.direAge],
                          ['donnees.fraicheur', don.fraicheur],
                          ['Fraicheur.depuis', frch.depuis]]) {
    if (typeof f !== 'function') {
      fautes.push(nom + ' n’existe plus : l’essai ne peut pas garantir que les '
        + 'étiquettes d’âge s’accordent');
      return { notes, fautes };
    }
  }

  // ── les trois doivent rendre exactement la même chose
  const maintenant = Date.parse('2026-08-28T12:00:00.000Z');
  const desaccords = [];
  for (const min of AGES) {
    const iso = new Date(maintenant - min * 60000).toISOString();
    const a = prov.direAge(iso, new Date(maintenant));
    const b = frch.depuis(iso, maintenant);
    // `fraicheur` lit l'horloge réelle : on la compare sur un instant réel.
    const isoReel = new Date(Date.now() - min * 60000).toISOString();
    const c = don.fraicheur(isoReel);

    if (a !== b) desaccords.push(min + ' min : direAge « ' + a + ' » ≠ depuis « ' + b + ' »');
    if (a !== c) desaccords.push(min + ' min : direAge « ' + a + ' » ≠ fraicheur « ' + c + ' »');
  }

  if (desaccords.length) {
    fautes.push('les étiquettes d’âge ne s’accordent pas — c’est le défaut vu '
      + 'sur téléphone, deux réponses pour la même donnée :\n        '
      + desaccords.slice(0, 6).join('\n        '));
  } else {
    notes.push(AGES.length + ' âges éprouvés, dont 89/91 et 149/151 min qui '
      + 'divergeaient : les trois fonctions rendent le même texte');
  }

  // ── et une seule d'entre elles a le droit de CALCULER
  //
  // Les deux autres doivent déléguer. Sans ça, elles s'accordent aujourd'hui
  // et divergeront à la première retouche de l'une des deux — c'est
  // exactement comme ça que le défaut est né.
  const calculent = [];
  for (const [nom, rel] of [['donnees.js', 'donnees.js'],
                            ['composants/Fraicheur.js', 'composants/Fraicheur.js']]) {
    const src = sansCommentaires(fs.readFileSync(path.join(APP, rel), 'utf8'));
    // La signature d'un calcul d'âge : une division par 60 000 ou par 60
    // suivie d'une fabrication de texte « il y a … ».
    // ⚠️  LE « \s*\( » N'EST PAS DÉCORATIF.
    //
    // Sans lui, le motif s'écrivait `export function (fraicheur|depuis)` et
    // attrapait `export function depuisMaintenant` — une fonction qui n'a
    // rien à voir, définie plus haut dans le même fichier. Ce bras d'essai
    // inspectait donc le mauvais bloc et ne se déclenchait JAMAIS : il
    // donnait une assurance vide. Repéré en sabotant `fraicheur` et en
    // constatant qu'une seule faute remontait au lieu de deux.
    const bloc = src.match(/export function (?:fraicheur|depuis)\s*\([\s\S]{0,700}?\n\}/);
    if (!bloc) {
      calculent.push(nom + ' : la fonction d’âge est introuvable — ce contrôle '
        + 'ne prouve plus rien, il faut le réparer avant de le croire');
      continue;
    }
    if (/Math\.(round|floor)\s*\(\s*min\s*\/\s*60\s*\)/.test(bloc[0])
        || /il y a.*\$\{h\}|'il y a ' \+ h\b/.test(bloc[0])) {
      calculent.push(nom + ' refabrique une règle d’âge au lieu de déléguer à '
        + 'direAge : elle divergera à la prochaine retouche');
    }
  }
  if (calculent.length) fautes.push(...calculent);
  else notes.push('donnees.js et Fraicheur.js délèguent, ils ne recalculent plus');

  return { notes, fautes };
};
