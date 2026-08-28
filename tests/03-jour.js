/**
 * Aucune activité de plein air ne doit être proposée dans le noir.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Rien ne bornait les activités au jour, sauf la croisière coucher de soleil.
 * Ce n'était pas une omission sans conséquence : l'alizé TOMBE la nuit. Les
 * heures nocturnes sont donc exactement celles qui passent le mieux les
 * seuils de vent, et l'application annonçait, sans ironie :
 *
 *     Randonnée jet-ski     — de 20 h à 1 h le lendemain
 *     Plongée dans le lagon — de 20 h à 9 h le lendemain
 *
 * Le défaut est resté invisible tant que le jeu de test calait le vent sur la
 * position dans le tableau au lieu de l'heure du jour : les nuits n'y étaient
 * pas plus calmes que les jours. Une donnée de test à la mauvaise forme cache
 * précisément le défaut qu'elle devrait révéler.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ce test refabrique DEUX pièges, sur neuf îles et trois dates réparties dans
 * l'année :
 *
 *   1. vent calme la nuit, fort le jour — si la borne du jour saute, chaque
 *      activité repart aussitôt en pleine nuit ;
 *   2. quarante-huit heures parfaites — si le regroupement des heures
 *      favorables ne coupe pas sur le trou de la nuit, les deux journées
 *      fusionnent en une plage de trente-six heures.
 *
 * Le second a été ajouté après coup, et l'ordre compte : le premier piège ne
 * pouvait PAS prendre le second défaut. En cassant les suites d'heures au
 * milieu de la journée, il empêchait justement la fusion d'avoir lieu. Un jeu
 * de test taillé pour un défaut est aveugle au voisin.
 */

const { charger, aLApp } = require('./harnais');

const ILES = [
  { id: 'bora-bora', nom: 'Bora Bora', lat: -16.50, lon: -151.75 },
  { id: 'tahiti',    nom: 'Tahiti',    lat: -17.65, lon: -149.43 },
  { id: 'moorea',    nom: 'Moorea',    lat: -17.53, lon: -149.83 },
  { id: 'raiatea',   nom: 'Raiatea',   lat: -16.82, lon: -151.44 },
  { id: 'rangiroa',  nom: 'Rangiroa',  lat: -15.00, lon: -147.70 },
  { id: 'fakarava',  nom: 'Fakarava',  lat: -16.28, lon: -145.55 },
  { id: 'nuku-hiva', nom: 'Nuku Hiva', lat: -8.90,  lon: -140.10, archipel: 'Marquises' },
  { id: 'tubuai',    nom: 'Tubuai',    lat: -23.37, lon: -149.48 },
  { id: 'gambier',   nom: 'Gambier',   lat: -23.12, lon: -134.97 }
];

const DATES = ['2026-01-15', '2026-06-21', '2026-09-30'];

const heureDe = (t) => parseInt(String(t).slice(11, 13), 10);

/** L'instant absolu, en heures depuis l'époque. Sert à mesurer la DURÉE d'un
 *  créneau, ce que l'heure du jour seule ne dit pas. */
const instant = (t) => Date.parse(String(t) + ':00Z') / 3600000;

/** Vent calme la nuit, fort le jour : le piège, à l'envers d'un vrai souci. */
function serie(depart) {
  const h = [];
  for (let i = 0; i < 48; i++) {
    const d = new Date(depart.getTime() + i * 3600000);
    const hh = d.getUTCHours();
    const nuit = hh < 6 || hh >= 18;
    h.push({
      t: d.toISOString().slice(0, 13) + ':00',
      vent: nuit ? 5 : 26, rafale: nuit ? 7 : 34, dir: 120,
      houle: nuit ? 0.4 : 2.6, periode: 11, houleDir: 200,
      pluie: 0, uv: nuit ? 0 : 6, uvClair: nuit ? 0 : 8, temp: 27, ciel: 0
    });
  }
  return h;
}

/**
 * Le SECOND piège : deux jours de suite parfaitement beaux.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * La série ci-dessus casse les suites d'heures favorables au milieu de la
 * journée — le vent y est fort de jour. Aucune activité n'y tient donc une
 * journée entière, et la fusion par-dessus la nuit ne peut pas se produire.
 * Le piège qu'elle tend ne prend que le défaut qu'elle a été écrite pour
 * prendre.
 *
 * Il faut donc l'inverse : quarante-huit heures sans un défaut. Alors toutes
 * les heures de jour sont retenues, celles du premier jour touchent celles du
 * second dans le tableau, et un regroupement qui ne compare que les positions
 * les recolle en une seule plage de trente-cinq heures.
 * ═══════════════════════════════════════════════════════════════════════
 */
function serieParfaite(depart) {
  const h = [];
  for (let i = 0; i < 48; i++) {
    const d = new Date(depart.getTime() + i * 3600000);
    const nuit = d.getUTCHours() < 6 || d.getUTCHours() >= 18;
    h.push({
      t: d.toISOString().slice(0, 13) + ':00',
      vent: 6, rafale: 8, dir: 120,
      houle: 0.3, periode: 12, houleDir: 200,
      pluie: 0, uv: nuit ? 0 : 6, uvClair: nuit ? 0 : 7, temp: 28, ciel: 0
    });
  }
  return h;
}

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const A = charger('activites');
  const soleil = charger('soleil');
  const fautes = [];
  let creneaux = 0;

  for (const ile of ILES) {
    for (const date of DATES) {
      const dec = ile.archipel === 'Marquises' ? -9.5 : -10;
      const minuit = new Date(Date.parse(date + 'T00:00:00Z') - dec * 3600000);
      const zero = new Date(minuit.getTime() + dec * 3600000);

      const fenetre = A.fenetreDeJour(ile, minuit);
      const j = soleil.journee(minuit, ile.lat, ile.lon, dec);
      const enHeures = (d) => {
        const l = new Date(d.getTime() + dec * 3600000);
        return l.getUTCHours() + l.getUTCMinutes() / 60;
      };

      const jeux = [
        { quoi: 'nuit calme', heures: serie(zero) },
        { quoi: 'deux beaux jours', heures: serieParfaite(zero) }
      ];

      for (const jeu of jeux)
      for (const a of [...A.activitesPour('visiteur'), ...A.activitesPour('pro')]) {
        const e = A.evaluerActivite(a, jeu.heures, fenetre);

        // ⚠️  Un verdict FAVORABLE sans une seule heure à montrer est un
        // mensonge par omission. Les éclaircies d'une heure sont écartées
        // (invendables), et elles l'étaient EN SILENCE : la vignette disait
        // « FAVORABLE — jugé sur demain » et rien d'autre. Ce qu'on écarte
        // doit remonter dans « brefs ».
        if (e.cat === 'ok' && !(e.creneaux || []).length && !(e.brefs || []).length) {
          fautes.push(`${ile.nom} ${date} [${jeu.quoi}] — ${a.nom} : favorable, `
            + 'et pas une heure à montrer (ni créneau ni éclaircie brève)');
        }

        for (const c of e.creneaux || []) {
          creneaux++;
          const d0 = heureDe(c.debut), d1 = heureDe(c.fin);

          // ⚠️  Les deux bouts peuvent être en plein jour et le créneau
          // traverser quand même la nuit. Le filtre du jour rend le 17 h d'un
          // jour VOISIN du 7 h du lendemain dans le tableau ; une suite de
          // bonnes heures les recollait donc par-dessus le noir :
          //
          //     Randonnée — demain de 7 h à 18 h le lendemain   (35 heures)
          //
          // Aucune borne d'heure du jour ne l'attrape : 7 h et 18 h sont l'un
          // et l'autre irréprochables. Il faut mesurer la durée réelle.
          const duree = instant(c.fin) - instant(c.debut);
          if (duree > 16) {
            fautes.push(`${ile.nom} ${date} [${jeu.quoi}] — ${a.nom} : créneau de ${duree} h `
              + `(${c.debut} → ${c.fin}) — il enjambe la nuit`);
            continue;
          }

          // Une fourchette absolue déclarée l'emporte : c'est le contrat de
          // la croisière coucher de soleil, qui rentre après la tombée du jour.
          if (a.heures) {
            if (d0 < a.heures[0] || d1 > a.heures[1]) {
              fautes.push(`${ile.nom} ${date} [${jeu.quoi}] — ${a.nom} : ${d0} h→${d1} h hors de sa fourchette ${a.heures}`);
            }
            continue;
          }

          const tot = a.avantAube || 0;
          const min = Math.floor(enHeures(j.lever)) - tot - 1;
          const max = Math.ceil(enHeures(j.coucher));
          if (d0 < min || d1 > max) {
            fautes.push(`${ile.nom} ${date} [${jeu.quoi}] — ${a.nom} : ${d0} h→${d1} h, `
              + `jour ${enHeures(j.lever).toFixed(1)}→${enHeures(j.coucher).toFixed(1)}`);
          }
        }
      }
    }
  }

  return {
    notes: [creneaux + ' créneaux vérifiés sur ' + ILES.length + ' îles × ' + DATES.length + ' dates'],
    fautes
  };
};
