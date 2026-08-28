/**
 * La Polynésie a TROIS fuseaux, et l'application n'en connaissait qu'un et demi.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LE DÉFAUT
 *
 *   Société, Tuamotu, Australes .... UTC−10
 *   Marquises ...................... UTC−9 h 30
 *   Gambier ........................ UTC−9
 *
 * Deux fautes se superposaient.
 *
 * 1. Le backend interrogeait Open-Meteo en `timezone=Pacific/Tahiti` pour
 *    les NEUF îles. Les heures des paquets de Nuku Hiva et des Gambier
 *    étaient donc de l'heure de Tahiti — trente minutes d'écart aux
 *    Marquises, une heure pleine aux Gambier. Un pêcheur de Rikitea lisait
 *    « de 7 h à 15 h » pour ce qui est, à sa montre, 8 h à 16 h.
 *
 * 2. L'application, elle, écrivait `archipel === 'Marquises' ? -9.5 : -10`
 *    à CINQ endroits. Les Gambier tombaient dans le « sinon ». Et aux
 *    Marquises, le même écran mélangeait deux bases de temps : des heures
 *    de prévision en heure de Tahiti et un lever de soleil en heure des
 *    Marquises.
 *
 * Aucun banc ne pouvait le voir : tous les jeux d'essai étaient calés sur
 * Bora Bora, où les deux règles donnent la même réponse.
 *
 * ⚠️  CE TEST EXIGE QUE LES DEUX CÔTÉS SOIENT D'ACCORD.
 *
 * Le paquet porte le décalage que l'API a réellement appliqué ; la fonction
 * `decalageIle` de l'application doit rendre le même. Deux sources pour une
 * même information, c'est une source de trop — sauf si on vérifie à chaque
 * publication qu'elles disent la même chose.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { charger, aLApp } = require('./harnais');

/** Ce que la géographie impose, île par île. */
const ATTENDU = {
  'bora-bora': -10,
  'tahiti': -10,
  'moorea': -10,
  'raiatea': -10,
  'rangiroa': -10,
  'fakarava': -10,
  'tubuai': -10,
  'nuku-hiva': -9.5,
  'gambier': -9
};

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const dossier = path.resolve(__dirname, '..', 'paquets');
  if (!fs.existsSync(path.join(dossier, 'bora-bora.json'))) {
    return { saute: 'aucun paquet (lancer « npm run demo » d’abord)' };
  }

  const F = charger('fuseau');
  const fautes = [];
  const notes = [];

  // ── 1. La table de secours de l'application connaît les trois fuseaux.
  for (const [id, attendu] of Object.entries(ATTENDU)) {
    const p = path.join(dossier, id + '.json');
    if (!fs.existsSync(p)) { fautes.push('paquet manquant : ' + id); continue; }
    const paquet = JSON.parse(fs.readFileSync(p, 'utf8'));

    // Ce que le backend a publié.
    if (typeof paquet.decalage !== 'number') {
      fautes.push(id + ' : le paquet ne porte pas de décalage horaire — '
        + 'l’application devra le deviner');
    } else if (paquet.decalage !== attendu) {
      fautes.push(id + ' : le paquet annonce ' + paquet.decalage
        + ' h, la géographie dit ' + attendu + ' h');
    }

    // Ce que l'application en fait.
    const lu = F.decalageIle(paquet);
    if (lu !== attendu) {
      fautes.push(id + ' : l’application lit ' + lu + ' h au lieu de ' + attendu + ' h');
    }

    // ⚠️  Et sans le champ publié, la table de secours doit tenir seule :
    // c'est le cas d'un paquet ancien resté en cache sur un téléphone.
    const sansChamp = { archipel: paquet.archipel };
    const secours = F.decalageIle(sansChamp);
    if (secours !== attendu) {
      fautes.push(id + ' : sans le champ publié, l’application retombe sur '
        + secours + ' h au lieu de ' + attendu + ' h (archipel « '
        + paquet.archipel + ' »)');
    }
  }
  notes.push(Object.keys(ATTENDU).length + ' îles, trois fuseaux vérifiés des deux côtés');

  // ── 2. Les heures du paquet sont bien dans CE fuseau-là.
  //
  // On compare la première heure publiée à l'heure locale calculée depuis
  // l'horodatage de génération. Un écart de plus de deux heures veut dire
  // que le paquet a été daté dans un autre fuseau que le sien.
  for (const id of ['nuku-hiva', 'gambier', 'bora-bora']) {
    const paquet = JSON.parse(fs.readFileSync(path.join(dossier, id + '.json'), 'utf8'));
    const dec = paquet.decalage;
    if (typeof dec !== 'number' || !paquet.genere) continue;

    const premiere = paquet.spots[0].heures[0].t;
    const attenduLocal = new Date(Date.parse(paquet.genere) + dec * 3600000)
      .toISOString().slice(0, 13);
    const ecart = Math.abs(
      (Date.parse(premiere + ':00Z') - Date.parse(attenduLocal + ':00:00Z')) / 3600000
    );
    if (ecart > 2) {
      fautes.push(id + ' : la première heure publiée (' + premiere
        + ') est à ' + ecart + ' h de l’heure locale attendue — '
        + 'le paquet a été daté dans un autre fuseau que le sien');
    }
    notes.push(id + ' : ' + premiere + ' à ' + dec + ' h (écart ' + ecart + ' h)');
  }

  return { notes, fautes };
};
