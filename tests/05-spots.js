/**
 * Les coordonnées des points de mesure.
 *
 * Ce test ne dépend PAS des sources de l'application : il tourne partout, y
 * compris dans l'intégration continue où seul le backend est déployé.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LES NEUF PASSES ONT ÉTÉ RELEVÉES DANS OPENSTREETMAP LE 27 AOÛT.
 *
 * Avant : les vingt-et-une coordonnées étaient écrites à deux décimales,
 * estimées à la lecture d'une carte. Sur une passe, l'écart n'était pas
 * cosmétique — mesuré contre l'objet OSM correspondant :
 *
 *     Fakarava / Passe Garuae      10,91 km
 *     Rangiroa / Passe de Tiputa    4,67 km
 *     Moorea / Passe d'Opunohu      4,22 km
 *     Tahiti / Passe de Papeete     4,16 km
 *     Tubuai / Passe nord           3,83 km
 *     Raiatea / Passe Teavapiti     2,71 km
 *     Bora Bora / Passe Teavanui    1,61 km
 *
 * Une passe est sur le récif. « Passe Garuae » posée à onze kilomètres n'est
 * plus la passe : la carte y dessinait un rond nommé en pleine mer, sous une
 * légende affirmant « les ronds sont les points de mesure ».
 *
 * Sur la prévision, trois des onze corrections changent la houle lue —
 * Papeete passait de 1,1–1,3 m à 1,4–1,6 m, parce que l'ancien point était
 * dans le port et non sur le seuil. Les huit autres tombent dans la même
 * maille du modèle : elles ne corrigent « que » la carte.
 *
 * ⚠️  RÈGLE POSÉE ICI : une PASSE doit être un objet relevé, pas une position
 * estimée. C'est le seul type de point dont l'erreur se paie en mer, et c'est
 * donc le seul dont l'imprécision fait échouer la publication.
 *
 * Les autres — un DCP mouillé au large, « Lagon nord », « Au large, sud » —
 * sont des positions CHOISIES, pas des lieux à relever : il n'existe aucun
 * objet OSM à leur nom. Elles restent notées, sans bloquer.
 *
 * Restent à relever, quand l'occasion se présentera : Baie de Povai (Bora
 * Bora), Baie de Phaéton (Tahiti), Rikitea (Gambier) — trois lieux réels
 * qu'OpenStreetMap connaît, mais dont le nœud tombe à terre ; les déplacer
 * dessus ferait perdre la houle. Il faut un point d'eau devant, pas le nœud.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

/** Décimales telles qu'ÉCRITES dans le fichier, pas telles que lues.
 *  `-16.50` et `-16.5` sont le même nombre une fois analysés : compter sur le
 *  nombre ferait passer une coordonnée au demi-kilomètre pour une coordonnée
 *  à cinq kilomètres près. */
function decimalesEcrites(texte) {
  const re = /"(lat|lon)"\s*:\s*(-?\d+(?:\.(\d+))?)/g;
  const suite = [];
  let m;
  while ((m = re.exec(texte)) !== null) suite.push(m[3] ? m[3].length : 0);
  return suite;
}

module.exports = function () {
  const fichier = path.resolve(__dirname, '..', 'spots.json');
  const brut = fs.readFileSync(fichier, 'utf8');
  const registre = JSON.parse(brut);
  const dec = decimalesEcrites(brut);

  const notes = [];
  const fautes = [];
  const dettes = [];

  let k = 0, total = 0;
  const vus = new Set();

  for (const ile of registre.iles) {
    for (const sp of ile.spots || []) {
      total++;
      const dLat = dec[k++], dLon = dec[k++];
      const d = Math.min(dLat === undefined ? 9 : dLat, dLon === undefined ? 9 : dLon);

      // Ce qui est une VRAIE faute, et doit arrêter la publication :
      if (typeof sp.lat !== 'number' || typeof sp.lon !== 'number') {
        fautes.push(ile.nom + ' / ' + sp.nom + ' : coordonnée absente ou non numérique');
        continue;
      }
      if (sp.lat < -90 || sp.lat > 90 || sp.lon < -180 || sp.lon > 180) {
        fautes.push(ile.nom + ' / ' + sp.nom + ' : coordonnée hors du globe');
      }
      // La Polynésie française tient dans cette boîte. Un point qui en sort
      // est une faute de saisie, pas une imprécision.
      if (sp.lat > -6 || sp.lat < -30 || sp.lon > -130 || sp.lon < -158) {
        fautes.push(ile.nom + ' / ' + sp.nom + ' : hors de la Polynésie française');
      }
      if (!sp.id || !sp.nom || !sp.type) {
        fautes.push(ile.nom + ' / ' + (sp.nom || sp.id || '?') + ' : id, nom ou type manquant');
      }
      const cle = ile.nom + '·' + sp.id;
      if (vus.has(cle)) fautes.push('identifiant en double : ' + cle);
      vus.add(cle);

      // Une PASSE imprécise est une faute : c'est le seul point dont
      // l'erreur se paie en mer.
      if (d < 3) {
        if (sp.type === 'passe') {
          fautes.push(ile.nom + ' / ' + sp.nom + ' : passe écrite à ' + d
            + ' décimales — à relever dans OpenStreetMap avant publication');
        } else {
          dettes.push(ile.nom + ' / ' + sp.nom);
        }
      }
    }
  }

  const passes = registre.iles.reduce(
    (n, i) => n + (i.spots || []).filter((s) => s.type === 'passe').length, 0);
  notes.push(total + ' points sur ' + registre.iles.length + ' îles, dont '
    + passes + ' passes — toutes relevées');
  if (dettes.length) {
    notes.push(dettes.length + ' position(s) choisie(s) et non relevée(s), sans objet OSM à leur nom : '
      + dettes.join(', '));
  }

  return { notes, fautes };
};
