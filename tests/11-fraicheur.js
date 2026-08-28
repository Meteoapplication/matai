/**
 * « Mise à jour à 18 h 43 » doit vouloir dire quelque chose.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE TEST GARDE
 *
 * Le backend s'exécute toutes les heures. Il redemande à Open-Meteo, il
 * réécrit les fichiers, il tamponne l'heure du passage. L'application
 * affichait donc « mis à jour il y a 5 minutes » vingt-quatre fois par
 * jour — exact, et trompeur.
 *
 * Un modèle météo global ne sort pas toutes les heures : l'ECMWF tourne
 * quatre fois par jour. Entre deux sorties, redemander vingt fois donne
 * vingt fois la même prévision. Quelqu'un qui lit « il y a 5 minutes »
 * croit avoir du neuf ; il a une prévision de six heures, republiée.
 *
 * Ce n'est pas cosmétique. Qui décide de sortir en mer accorde du crédit à
 * la fraîcheur affichée. Une fraîcheur fausse est un crédit volé.
 *
 * ⚠️  LE PIÈGE DE CE FICHIER-LÀ
 *
 * L'empreinte ne doit porter QUE sur les prévisions. La première version
 * incluait `genere` — qui change à chaque passage par construction — et
 * trouvait donc du neuf à chaque fois : elle reproduisait exactement le
 * comportement qu'elle devait corriger, en plus compliqué.
 *
 * Les deux premiers essais ci-dessous sont là pour ça, et ils sont les
 * plus importants du fichier.
 * ═══════════════════════════════════════════════════════════════════════
 */

const path = require('path');

/** Un paquet minimal, avec de quoi le faire varier. */
function paquet(vent, genere) {
  return {
    version: 2,
    genere: genere || '2026-08-27T06:00:00.000Z',
    ile: 'bora-bora',
    vigilance: { etat: 'inconnu', maj: genere },
    nuages: { horodatage: genere },
    spots: [{
      id: 'passe',
      heures: [
        { t: '2026-08-27T06:00', vent, rafale: 20, dir: 135, pluie: 0, temp: 27,
          ciel: 0, houle: 1.4, periode: 11, houleDir: 200, swell: 1.1,
          swellPer: 13, swellDir: 195 },
        { t: '2026-08-27T07:00', vent: vent + 1, rafale: 21, dir: 137, pluie: 0,
          temp: 27, ciel: 0, houle: 1.4, periode: 11, houleDir: 200, swell: 1.1,
          swellPer: 13, swellDir: 195 }
      ]
    }]
  };
}

module.exports = async function () {
  const F = await import(
    'file://' + path.resolve(__dirname, '..', 'fraicheur.mjs')
  );

  const fautes = [];
  const notes = [];

  const t0 = new Date('2026-08-27T06:00:00Z');
  const t1 = new Date('2026-08-27T07:00:00Z');
  const t2 = new Date('2026-08-27T08:00:00Z');

  // ── 1. Premier passage : c'est neuf, forcément.
  const a = F.dater(paquet(18), undefined, t0);
  if (!a.change) fautes.push('le premier passage n’est pas compté comme neuf');
  if (a.majReelle !== t0.toISOString()) fautes.push('le premier passage n’est pas daté de maintenant');

  // ── 2. LE TEST QUI COMPTE : même prévision, passage suivant.
  //
  // `genere` a changé, la vigilance a changé, l'horodatage des nuages a
  // changé — comme dans la vraie vie. Les VALEURS MÉTÉO, elles, sont
  // identiques. La date de mise à jour ne doit pas bouger d'une seconde.
  const memeMeteo = paquet(18, '2026-08-27T07:00:00.000Z');
  const b = F.dater(memeMeteo, { empreinte: a.empreinte, majReelle: a.majReelle }, t1);
  if (b.change) {
    fautes.push('des prévisions IDENTIQUES ont été comptées comme une mise à jour '
      + '— l’empreinte attrape autre chose que la météo (genere ? vigilance ? nuages ?)');
  }
  if (b.majReelle !== a.majReelle) {
    fautes.push('la date de mise à jour a bougé alors que les prévisions n’ont pas changé');
  }
  if (b.republications !== 1) {
    fautes.push('le compteur de republications vaut ' + b.republications + ' au lieu de 1');
  }

  // ── 3. Une vraie nouvelle prévision redate.
  const c = F.dater(paquet(21, '2026-08-27T08:00:00.000Z'),
    { empreinte: b.empreinte, majReelle: b.majReelle, republications: b.republications }, t2);
  if (!c.change) fautes.push('un vent qui passe de 18 à 21 nœuds n’a pas été vu comme neuf');
  if (c.majReelle !== t2.toISOString()) fautes.push('la nouvelle prévision n’est pas datée de maintenant');
  if (c.republications !== 0) fautes.push('le compteur de republications n’est pas remis à zéro');

  notes.push('empreinte stable sur météo identique, changée sur météo différente');

  // ── 4. Chaque champ météo compte, un par un.
  //
  // Sans ce balayage, on ne saurait pas si l'empreinte lit VRAIMENT tous
  // les champs ou seulement le premier. Un champ oublié, c'est une
  // prévision qui change sans que la date bouge — le défaut inverse, et
  // tout aussi trompeur.
  const CHAMPS = ['vent', 'rafale', 'dir', 'pluie', 'temp', 'ciel',
                  'houle', 'periode', 'houleDir', 'swell', 'swellPer', 'swellDir'];
  const base = paquet(18);
  const ref = F.empreinte(base);
  const sourds = [];
  for (const champ of CHAMPS) {
    const abime = JSON.parse(JSON.stringify(base));
    const v = abime.spots[0].heures[0][champ];
    abime.spots[0].heures[0][champ] = (typeof v === 'number') ? v + 7 : 99;
    if (F.empreinte(abime) === ref) sourds.push(champ);
  }
  if (sourds.length) {
    fautes.push('l’empreinte ne voit pas changer : ' + sourds.join(', ')
      + ' — ces prévisions changeraient sans que la date de mise à jour bouge');
  }
  notes.push(CHAMPS.length + ' champs météo, tous pris dans l’empreinte');

  // ── 5. La prochaine vérification est dans le futur, et à l'heure ronde.
  const p = F.prochainPassage(new Date('2026-08-27T06:43:00Z'), 60);
  if (p.getTime() <= Date.parse('2026-08-27T06:43:00Z')) {
    fautes.push('la prochaine vérification n’est pas dans le futur');
  }
  if (p.getUTCMinutes() !== 0) {
    fautes.push('la prochaine vérification ne tombe pas à l’heure ronde : ' + p.toISOString());
  }
  notes.push('06 h 43 → prochaine vérification à ' + p.toISOString().slice(11, 16));

  return { notes, fautes };
};
