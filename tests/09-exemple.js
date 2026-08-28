/**
 * Le paquet d'exemple doit porter les mêmes champs que les vrais.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * `src/exemple.json` est embarqué dans l'application. C'est ce qu'elle
 * affiche au TOUT PREMIER lancement, avant d'avoir pu télécharger quoi que
 * ce soit — c'est-à-dire exactement le scénario qu'on prétend servir : le
 * pêcheur qui installe l'app à Papeete et l'ouvre en mer.
 *
 * Il avait dérivé. Température, code du ciel, pluie et index UV ont été
 * ajoutés aux paquets réels au fil des semaines ; personne n'est revenu
 * mettre l'exemple à jour. Au premier lancement, l'écran d'accueil
 * n'affichait donc NI TEMPÉRATURE NI MOT DU CIEL : un grand tiret à la place
 * du chiffre, cinq tirets dans la bande des heures, trois vignettes de jours
 * vides.
 *
 * Personne ne l'avait vu, et c'est logique : tous les bancs d'essai
 * nourrissaient l'app avec un paquet frais du backend. L'exemple embarqué
 * n'était jamais celui qu'on regardait. Il a fallu exporter l'application
 * pour de bon et l'ouvrir sans réseau pour le voir.
 *
 * Ce test compare les DEUX : chaque champ présent dans un paquet fabriqué
 * par le backend doit exister dans l'exemple. La prochaine dérive s'annonce
 * au lieu d'attendre un utilisateur.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { APP, aLApp } = require('./harnais');

/** Champs propres aux images satellite : ils n'ont rien à faire dans un
 *  exemple embarqué, qui doit tenir dans le code sans rien télécharger. */
const HORS_EXEMPLE = new Set(['nuages', 'cielRegional']);

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const chemin = path.resolve(APP, 'exemple.json');
  if (!fs.existsSync(chemin)) {
    return { fautes: ['src/exemple.json est introuvable'], notes: [] };
  }

  const reference = path.resolve(__dirname, '..', 'paquets', 'bora-bora.json');
  if (!fs.existsSync(reference)) {
    return { saute: 'aucun paquet de référence (lancer « npm run demo » d’abord)' };
  }

  const ex = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  const vrai = JSON.parse(fs.readFileSync(reference, 'utf8'));

  const fautes = [];
  const notes = [];

  // ── les champs du paquet
  for (const k of Object.keys(vrai)) {
    if (HORS_EXEMPLE.has(k)) continue;
    if (!(k in ex)) fautes.push('paquet : le champ « ' + k + ' » manque dans l’exemple');
  }

  // ── les champs d'un point de mesure
  const spEx = (ex.spots || [])[0];
  const spVrai = (vrai.spots || [])[0];
  if (!spEx) fautes.push('l’exemple n’a aucun point de mesure');
  else if (spVrai) {
    for (const k of Object.keys(spVrai)) {
      if (k === 'heures') continue;
      if (!(k in spEx)) fautes.push('point de mesure : le champ « ' + k + ' » manque');
    }
  }

  // ── les champs d'une heure, et surtout leur VALEUR
  const hEx = spEx && (spEx.heures || [])[0];
  const hVrai = spVrai && (spVrai.heures || [])[0];
  if (!hEx) fautes.push('l’exemple n’a aucune heure');
  else if (hVrai) {
    for (const k of Object.keys(hVrai)) {
      if (!(k in hEx)) {
        fautes.push('heure : le champ « ' + k + ' » manque — l’écran d’accueil se taira dessus');
      }
    }

    // ⚠️  Présent ne suffit pas : un champ à null sur TOUTES les heures est
    // un champ absent qui a l'air présent. C'est la température et le code du
    // ciel qui laissaient l'accueil vide, pas leur absence de clé.
    const heures = spEx.heures || [];
    for (const k of ['temp', 'ciel', 'vent', 'houle']) {
      const utiles = heures.filter((h) => h[k] !== null && h[k] !== undefined);
      if (heures.length && utiles.length === 0) {
        fautes.push('heure : « ' + k +' » est nul sur les ' + heures.length
          + ' heures de l’exemple — présent dans la clé, absent à l’écran');
      }
    }

    notes.push(heures.length + ' heures dans l’exemple, '
      + Object.keys(hVrai).length + ' champs par heure');
  }

  notes.push((ex.spots || []).length + ' points de mesure, île : ' + (ex.nom || '?'));
  if (ex.avertissement) notes.push('l’avertissement est présent');
  else fautes.push('l’avertissement manque : rien ne dira que ce sont des données d’exemple');

  return { notes, fautes };
};
