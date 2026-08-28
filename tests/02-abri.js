/**
 * L'exposition d'une côte à la houle — la géométrie, pas les mots.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CE TEST A ÉTÉ RÉÉCRIT PARCE QUE LE PREMIER N'AFFIRMAIT RIEN.
 *
 * La version d'origine calculait la normale des quatre côtés d'un carré et
 * les IMPRIMAIT. Elle ne disait pas ce qu'on attendait. Elle « passait » donc
 * alors que les quatre normales pointaient vers l'intérieur de l'île : le
 * calcul d'abri désignait comme abritée exactement la façade qui prend la
 * houle. Un test qui affiche sans comparer n'est pas un test, c'est une
 * trace.
 *
 * Ici, chaque côté du carré a une valeur attendue, écrite noir sur blanc, et
 * le carré est parcouru dans les DEUX sens : une géométrie juste ne doit pas
 * dépendre du sens d'écriture du polygone dans OpenStreetMap.
 * ═══════════════════════════════════════════════════════════════════════
 */

const { charger, aLApp } = require('./harnais');

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const A = charger('abri');
  const notes = [];
  const fautes = [];

  const ecart = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  function veut(quoi, obtenu, attendu) {
    if (ecart(obtenu, attendu) >= 1) {
      fautes.push(quoi + ' : attendu ' + attendu + '°, obtenu ' + Math.round(obtenu) + '°');
    }
  }

  // Un carré autour de l'équateur : les quatre côtés, et ce que chacun doit
  // donner comme cap vers le large.
  const coins = [
    { lat: 1, lon: -1 }, { lat: 1, lon: 1 },
    { lat: -1, lon: 1 }, { lat: -1, lon: -1 }, { lat: 1, lon: -1 }
  ];

  for (const [sens, poly] of [['horaire', coins], ['antihoraire', [...coins].reverse()]]) {
    for (const s of A.segments([poly])) {
      if (s.a.lat === 1 && s.b.lat === 1) veut('côté nord (' + sens + ')', s.capLarge, 0);
      if (s.a.lat === -1 && s.b.lat === -1) veut('côté sud (' + sens + ')', s.capLarge, 180);
      if (s.a.lon === 1 && s.b.lon === 1) veut('côté est (' + sens + ')', s.capLarge, 90);
      if (s.a.lon === -1 && s.b.lon === -1) veut('côté ouest (' + sens + ')', s.capLarge, 270);
    }
  }
  notes.push('carré témoin : 8 côtés vérifiés, dans les deux sens de parcours');

  // Et sur de vraies îles : le segment le plus austral doit regarder au sud.
  // Tolérance large (70°) parce qu'une côte réelle est dentelée — on cherche
  // une inversion, pas une précision au degré.
  for (const id of ['moorea', 'tahiti', 'tubuai']) {
    const e = A.exposition(id, 180);
    if (!e || !e.segments || !e.segments.length) {
      fautes.push(id + ' : aucun segment de côte');
      continue;
    }
    let sud = e.segments[0];
    for (const s of e.segments) if (s.milieu.lat < sud.milieu.lat) sud = s;
    const d = A.ecartCap(sud.capLarge, 180);
    if (d >= 70) {
      fautes.push(id + ' : le point le plus austral regarde ' + Math.round(sud.capLarge) + '° (écart au sud ' + Math.round(d) + '°)');
    } else {
      notes.push(id + ' : point le plus austral à ' + Math.round(sud.capLarge) + '° (écart ' + Math.round(d) + '°)');
    }
  }

  // Un atoll n'a pas d'intérieur : la notion d'exposition n'y a pas de sens
  // et le calcul doit se taire plutôt que rendre des façades au hasard.
  for (const id of ['rangiroa', 'fakarava']) {
    if (A.exposition(id, 180) !== null) {
      fautes.push(id + ' : un atoll ne devrait pas avoir de façade exposée');
    }
  }
  notes.push('atolls : rangiroa et fakarava se taisent, comme prévu');

  return { notes, fautes };
};
