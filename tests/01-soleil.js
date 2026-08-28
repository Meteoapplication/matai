/**
 * Le soleil, sur toute l'année et sur toutes les îles.
 *
 * Ce test balaie 9 îles × 365 jours × 24 heures, soit près de quatre-vingt
 * mille instants, et vérifie qu'AUCUN ne renvoie de trou : pas de lever nul,
 * pas de durée négative, pas de phrase manquante, pas de coucher avant le
 * lever.
 *
 * Il existe à cause d'un défaut précis. `journee()` lisait le quantième AVANT
 * de décaler l'heure : à Tahiti, tout instant local à partir de 14 h
 * appartient déjà au lendemain UTC, et la fonction renvoyait alors le lever et
 * le coucher du JOUR SUIVANT. L'écran annonçait « lever du soleil dans 13 h »
 * à cinq heures de l'après-midi, au lieu de prévenir qu'il restait une heure
 * de jour — il se taisait exactement au moment où il devait parler.
 *
 * Un test à midi ne l'aurait jamais vu. C'est pour ça qu'on balaie les vingt-
 * quatre heures et pas une heure choisie.
 */

const fs = require('fs');
const path = require('path');
const { charger, aLApp } = require('./harnais');

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const S = charger('soleil');
  const registre = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'spots.json'), 'utf8'));
  const iles = registre.iles || registre;

  let cas = 0, nuls = 0, sansPhrase = 0, incoherent = 0;
  let crepMin = 999, crepMax = 0;
  const etats = {};

  for (const ile of iles) {
    // Les Marquises ont leur propre heure : −9 h 30. L'oublier décale tous
    // les horaires d'une demi-heure là-bas, et rien ne le signale.
    const dec = ile.archipel === 'Marquises' ? -9.5 : -10;
    const lat = ile.lat !== undefined ? ile.lat : ile.spots[0].lat;
    const lon = ile.lon !== undefined ? ile.lon : ile.spots[0].lon;

    for (let d = 0; d < 365; d++) {
      const jour = new Date(Date.UTC(2026, 0, 1) + d * 86400000);
      const j = S.journee(jour, lat, lon, dec);

      if (!j.lever || !j.coucher || j.crepusculeMin === null || j.nuitNoireMin === null) {
        nuls++;
        continue;
      }
      if (j.crepusculeMin < crepMin) crepMin = j.crepusculeMin;
      if (j.crepusculeMin > crepMax) crepMax = j.crepusculeMin;
      if (!(j.lever < j.coucher)) incoherent++;

      for (let h = 0; h < 24; h++) {
        const t = new Date(jour.getTime() + h * 3600000);
        const j2 = S.journee(t, lat, lon, dec);
        const r = S.resteDuJour(t, j2);
        cas++;
        if (!r) { nuls++; continue; }
        if (!r.phrase) sansPhrase++;
        etats[r.etat] = (etats[r.etat] || 0) + 1;
        if (r.minutes < 0) incoherent++;
      }
    }
  }

  const notes = [
    cas.toLocaleString('fr-FR') + ' instants (' + iles.length + ' îles × 365 j × 24 h)',
    'crépuscule civil : de ' + crepMin + ' à ' + crepMax + ' minutes',
    'états rencontrés : ' + JSON.stringify(etats)
  ];

  const fautes = [];
  if (nuls) fautes.push(nuls + ' résultat(s) nul(s)');
  if (sansPhrase) fautes.push(sansPhrase + ' phrase(s) manquante(s)');
  if (incoherent) fautes.push(incoherent + ' incohérence(s)');

  // Sous ces latitudes le crépuscule civil dure une vingtaine de minutes.
  // Une valeur très différente signalerait une erreur de seuil, pas une
  // saison : c'est justement ce que l'app annonce aux gens qui rentrent.
  if (crepMin < 15 || crepMax > 40) {
    fautes.push('crépuscule hors du plausible (' + crepMin + '–' + crepMax + ' min)');
  }

  return { notes, fautes };
};
