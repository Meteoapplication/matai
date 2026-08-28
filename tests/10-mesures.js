/**
 * La mesure réelle, et le zéro qu'on n'invente pas.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Ce fichier garde une règle et une seule : ce qui sort de `mesures.mjs`
 * est une MESURE, et une mesure absente doit rester absente.
 *
 * ⚠️  LE PIÈGE S'APPELLE « VRB ».
 *
 * Quand le vent est faible et tourne, le METAR n'écrit pas de cap : il
 * écrit `VRB`. C'est une information — « il n'y a pas de direction
 * établie » — et ce n'est pas zéro degré.
 *
 *     METAR NTAA 272000Z AUTO VRB02KT CAVOK 26/20 Q1018 NOSIG
 *
 * Un parseur qui fait `Number('VRB') || 0` plante l'aiguille de la rose
 * des vents plein nord, avec l'autorité d'une mesure, alors que la mesure
 * dit précisément qu'il n'y a pas de nord. C'est exactement la faute que
 * `04-degrade.js` traque ailleurs — un chiffre rassurant sorti de rien —
 * et elle arrive ici par une porte neuve.
 *
 * ⚠️  ET LA DISTANCE EST UNE DONNÉE DE SÉCURITÉ.
 *
 * Une seule station publie dans toute la Polynésie : Tahiti-Faa'a.
 * Vérifié le 27 août 2026 sur aviationweather.gov, code par code puis sur
 * toute l'emprise du Pacifique central. Servir sa mesure comme « les
 * conditions actuelles » à Rangiroa, à 350 km, serait une faute
 * silencieuse. La distance voyage donc avec la station, et l'application
 * s'en sert pour décider si elle a le droit de parler de mesure.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { charger, aLApp } = require('./harnais');

module.exports = async function () {
  const fixture = path.join(__dirname, 'donnees', 'metar-ntaa.json');
  if (!fs.existsSync(fixture)) {
    return { saute: 'relevé METAR de référence absent' };
  }

  const M = await import(
    'file://' + path.resolve(__dirname, '..', 'mesures.mjs')
  );

  const brut = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const faux = async () => ({ ok: true, json: async () => brut });

  const fautes = [];
  const notes = [];

  const m = await M.recuperer(faux);
  if (m.erreur) fautes.push('la lecture a échoué : ' + m.erreur);
  if (!m.stations.length) fautes.push('aucune station lue dans le relevé de référence');

  const st = m.stations[0];
  notes.push(st.oaci + ' — ' + st.releves.length + ' relevés lus');

  // ── VRB ne devient jamais une direction
  const variables = st.releves.filter((r) => r.variable);
  if (variables.length === 0) {
    fautes.push('le relevé de référence ne contient plus de « VRB » : '
      + 'ce test ne prouve plus rien, il faut en reprendre un qui en a');
  }
  for (const r of variables) {
    if (r.dir !== null) {
      fautes.push('« VRB » a produit une direction de ' + r.dir + '° — '
        + 'un cap inventé là où la mesure dit qu’il n’y en a pas');
    }
  }
  notes.push(variables.length + ' relevé(s) à direction variable, tous à null');

  // ── une vraie direction reste une vraie direction
  const nettes = st.releves.filter((r) => !r.variable);
  for (const r of nettes) {
    if (typeof r.dir !== 'number' || r.dir < 0 || r.dir >= 360) {
      fautes.push('direction hors bornes : ' + r.dir);
    }
  }

  // ── la vitesse est en nœuds, telle que le METAR la donne
  const vents = st.releves.map((r) => r.vent);
  if (vents.some((v) => typeof v !== 'number')) {
    fautes.push('une vitesse de vent n’est pas un nombre');
  }
  if (Math.max(...vents) > 200) fautes.push('vitesse aberrante : le METAR est déjà en nœuds');

  // ── les rafales sont facultatives et ne valent jamais zéro par défaut
  const sansRafale = st.releves.filter((r) => r.rafale === null);
  if (sansRafale.length === 0) {
    fautes.push('aucun relevé sans rafale dans la référence : le cas n’est pas éprouvé');
  }
  for (const r of sansRafale) {
    if (r.rafale === 0) fautes.push('une rafale absente a été rendue « 0 »');
  }

  // ── les relevés sont ordonnés et sans doublon
  for (let i = 1; i < st.releves.length; i++) {
    if (st.releves[i].t <= st.releves[i - 1].t) {
      fautes.push('relevés mal ordonnés ou en double autour de ' + st.releves[i].t);
    }
  }

  // ── la distance : Tahiti proche, les autres loin
  const cas = [
    { nom: 'Tahiti', lat: -17.65, lon: -149.43, max: 30 },
    { nom: 'Bora Bora', lat: -16.50, lon: -151.75, min: 200 },
    { nom: 'Rangiroa', lat: -15.00, lon: -147.70, min: 200 },
    { nom: 'Gambier', lat: -23.12, lon: -134.97, min: 1000 }
  ];
  for (const c of cas) {
    const r = M.pourIle(m, c);
    if (!r.station) { fautes.push(c.nom + ' : aucune station rendue'); continue; }
    if (c.max !== undefined && r.distanceKm > c.max) {
      fautes.push(c.nom + ' : station à ' + r.distanceKm + ' km, attendu moins de ' + c.max);
    }
    if (c.min !== undefined && r.distanceKm < c.min) {
      fautes.push(c.nom + ' : station à ' + r.distanceKm + ' km, attendu plus de ' + c.min);
    }
    notes.push(c.nom + ' → ' + r.station.nom + ' à ' + r.distanceKm + ' km');
  }

  // ── une panne de réseau ne rend pas un calme plat
  const casse = async () => { throw new Error('réseau coupé'); };
  const p = await M.recuperer(casse);
  if (!p.erreur) fautes.push('une panne de réseau n’a pas été signalée comme telle');
  if (p.stations.length) fautes.push('une panne de réseau a rendu des stations');

  const vide = M.pourIle(p, { lat: -17.5, lon: -149.5 });
  if (vide.station) fautes.push('une panne a quand même désigné une station');

  // ═══════════════════════════════════════════════════════════════════════
  // CÔTÉ APPLICATION : QUAND A-T-ON LE DROIT DE DIRE « MESURE » ?
  //
  // ⚠️  Y COMPRIS QUAND LE RELEVÉ EST DATÉ DANS LE FUTUR.
  //
  // La première version ne posait qu'une borne — « pas plus vieux que 75
  // minutes ». Un relevé daté deux heures dans le futur donnait un écart
  // NÉGATIF, donc inférieur au seuil, donc « frais » : affiché avec
  // l'étiquette MESURE et sans âge, puisque `direAge` se tait sur un écart
  // négatif. Un vent présenté comme relevé à l'instant, et qui ne
  // correspondait à rien.
  //
  // Ça n'arrive pas qu'aux serveurs : l'horloge d'un téléphone resté éteint
  // plusieurs jours sur un bateau dérive — et c'est précisément l'appareil
  // de quelqu'un qui rentre de mer.
  // ═══════════════════════════════════════════════════════════════════════
  if (aLApp()) {
    const Pr = charger('provenance');
    const t0 = new Date('2026-08-27T12:00:00Z');
    const releve = (minutes, distanceKm, vent) => ({
      station: { nom: 'Tahiti-Faa’a' },
      distanceKm,
      dernier: {
        t: new Date(t0.getTime() - minutes * 60000).toISOString().slice(0, 16) + 'Z',
        vent
      }
    });

    const CAS = [
      ['relevé de 10 min, à 5 km',      releve(10, 5, 12),    true,  true],
      ['relevé de 10 min, à 300 km',    releve(10, 300, 12),  false, true],
      ['relevé de 3 h, à 5 km',         releve(180, 5, 12),   true,  false],
      ['relevé sans vitesse de vent',   releve(10, 5, null),  false, true],
      ['relevé daté DANS 2 HEURES',     releve(-120, 5, 12),  true,  false],
      ['relevé daté dans 5 minutes',    releve(-5, 5, 12),    true,  true]
    ];
    for (const [nom, m, valable, fraiche] of CAS) {
      if (Pr.mesureValable(m) !== valable) {
        fautes.push(nom + ' : « valable pour ce lieu » vaut '
          + Pr.mesureValable(m) + ' au lieu de ' + valable);
      }
      if (Pr.mesureFraiche(m, t0) !== fraiche) {
        fautes.push(nom + ' : « fraîche » vaut '
          + Pr.mesureFraiche(m, t0) + ' au lieu de ' + fraiche);
      }
    }
    notes.push(CAS.length + ' cas de fraîcheur et de distance vérifiés côté application');
  }

  return { notes, fautes };
};
