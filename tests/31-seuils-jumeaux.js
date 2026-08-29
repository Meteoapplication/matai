/**
 * Les deux fichiers qui décident du vert, de l'ambre et du rouge.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE.
 *
 * `matai-backend/seuils.mjs` et `matai-app/src/seuils.js` sont jumeaux. Le
 * backend s'en sert pour calculer ce qu'il publie ; l'application s'en sert
 * pour colorer ce qu'elle affiche. Ils doivent rendre le MÊME verdict, sans
 * quoi un pêcheur voit une couleur qui ne correspond pas à ce qui a été
 * calculé pour lui.
 *
 * Jusqu'ici, ce qui les tenait ensemble était un commentaire :
 *
 *     « Les deux doivent rester identiques. Quand tu modifies l'un,
 *       modifie l'autre. »
 *
 * ⚠️  UN COMMENTAIRE N'EST PAS UN GARDE-FOU.
 *
 * Il ne se déclenche pas, il ne casse rien, et il ne se lit que par
 * quelqu'un qui a déjà ouvert le bon fichier. Le jour où un seuil change
 * d'un seul côté — et il changera, la note du fichier dit elle-même que ces
 * valeurs sont provisoires et attendent l'expérience de gens qui sortent en
 * mer — l'application afficherait « sortie favorable » en vert sur une
 * donnée que le backend a classée « no ». Rien ne le signalerait : les deux
 * moitiés du produit fonctionneraient parfaitement, chacune de son côté.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  ON NE COMPARE PAS LES FICHIERS, ON COMPARE LES DÉCISIONS.
 *
 * Comparer les textes serait plus simple et beaucoup plus faible : les deux
 * fichiers diffèrent LÉGITIMEMENT dans leur écriture — flèches contre
 * `function`, `...h` contre `Object.assign`, `Number.isNaN` contre `isNaN`.
 * Un essai sur le texte tomberait au rouge sur une reformulation sans
 * conséquence, et on prendrait vite l'habitude de le désarmer.
 *
 * Cet essai fait tourner LES DEUX implémentations sur une grille de
 * conditions — vent, houle, période, type de spot, et l'état précédent qui
 * porte l'hystérésis — et exige le même verdict à chaque case. Il se moque
 * de la façon dont c'est écrit ; il ne tolère aucune différence sur ce que
 * l'utilisateur voit.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const APP = path.resolve(RACINE, '..', 'matai-app');

module.exports = async function () {
  const fautes = [];
  const notes = [];

  const cheminApp = path.join(APP, 'src', 'seuils.js');
  if (!fs.existsSync(cheminApp)) {
    return { notes: ['matai-app/src/seuils.js absent de cet arbre : contrôle non fait'], fautes };
  }

  const B = await import('file://' + path.join(RACINE, 'seuils.mjs'));

  // L'application écrit en modules ES dans un fichier `.js`, que Node refuse
  // d'importer tel quel. On le recopie sous `.mjs` sans toucher une ligne.
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'matai-seuils-'));
  let A;
  try {
    const copie = path.join(dossier, 'seuils.mjs');
    fs.writeFileSync(copie, fs.readFileSync(cheminApp, 'utf8'));
    A = await import('file://' + copie);

    // ═════════════════════════════════════════════════════════════════════
    // ── 1. les valeurs, une par une
    // ═════════════════════════════════════════════════════════════════════
    {
      const types = new Set([...Object.keys(B.SEUILS), ...Object.keys(A.SEUILS)]);
      for (const t of types) {
        const b = B.SEUILS[t], a = A.SEUILS[t];
        if (!b || !a) {
          fautes.push('le type de spot « ' + t + ' » n’existe que d’un côté : '
            + 'backend ' + (b ? 'oui' : 'non') + ', application ' + (a ? 'oui' : 'non'));
          continue;
        }
        const cles = new Set([...Object.keys(b), ...Object.keys(a)]);
        for (const k of cles) {
          if (b[k] !== a[k]) {
            fautes.push('SEUILS.' + t + '.' + k + ' vaut ' + b[k] + ' dans le '
              + 'backend et ' + a[k] + ' dans l’application. Le backend publie '
              + 'une couleur, l’application en affiche une autre, et rien ne le '
              + 'dit : les deux moitiés fonctionnent parfaitement, chacune de '
              + 'son côté.');
          }
        }
      }
      if (!fautes.length) {
        notes.push(types.size + ' types de spot, toutes les valeurs identiques '
          + 'des deux côtés');
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // ── 2. ⚠️  ET LES DÉCISIONS, SUR UNE GRILLE
    //
    // C'est ce contrôle-là qui compte : les valeurs peuvent être identiques
    // pendant qu'une comparaison passe de `<` à `<=`, ou qu'une hystérésis
    // s'applique d'un seul côté.
    // ═════════════════════════════════════════════════════════════════════
    {
      const VENTS = [0, 5, 12, 16.4, 16.5, 17.9, 18, 19.9, 20, 23, 24, 25, 27.9, 28, 35, 60];
      const HOULES = [null, 0, 0.5, 1.7, 1.8, 2.0, 2.7, 2.8, 3.0, 4.5];
      const PERIODES = [null, 6, 11, 12, 12.9, 13, 16];
      const PRECEDENTS = [null, 'ok', 'mid', 'no', 'inconnu'];

      let n = 0;
      const ecarts = [];
      for (const type of Object.keys(B.SEUILS)) {
        for (const vent of VENTS) {
          for (const houle of HOULES) {
            for (const periode of PERIODES) {
              for (const precedent of PRECEDENTS) {
                const h = { vent, houle, periode };
                const rb = B.categorie(h, type, precedent);
                const ra = A.categorie(h, type, precedent);
                n++;
                if (rb !== ra && ecarts.length < 5) {
                  ecarts.push(type + ' · vent ' + vent + ' · houle ' + houle
                    + ' · période ' + periode + ' · précédent ' + precedent
                    + ' → backend « ' + rb + ' », application « ' + ra + ' »');
                }
              }
            }
          }
        }
      }
      if (ecarts.length) {
        fautes.push('LES DEUX CALCULS NE RENDENT PAS LE MÊME VERDICT sur '
          + ecarts.length + ' cas (ou plus) : ' + ecarts.join(' ; ')
          + '. Le pêcheur verrait une couleur différente de celle qui a été '
          + 'publiée pour lui.');
      } else {
        notes.push(n.toLocaleString('fr-FR') + ' combinaisons vent × houle × '
          + 'période × état précédent : même verdict des deux côtés');
      }

      // Les valeurs manquantes, qui sont le cas courant en mer.
      const absurdes = [
        { vent: null, houle: 1, periode: 10 },
        { vent: undefined, houle: 1, periode: 10 },
        { vent: NaN, houle: 1, periode: 10 },
        { vent: 20, houle: NaN, periode: 10 },
        { vent: 20, houle: 1, periode: NaN },
        {}
      ];
      for (const type of Object.keys(B.SEUILS)) {
        for (const h of absurdes) {
          const rb = B.categorie(h, type, null);
          const ra = A.categorie(h, type, null);
          if (rb !== ra) {
            fautes.push('sur une donnée manquante (' + JSON.stringify(h) + ', '
              + type + ') le backend rend « ' + rb + ' » et l’application « '
              + ra + ' » — or une mesure absente est le cas COURANT ici');
          }
        }
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // ── 3. `analyser` : la séquence entière, avec son hystérésis
    //
    // `categorie` reçoit l'état précédent ; c'est `analyser` qui le fait
    // circuler. Une divergence dans cette circulation ne se verrait pas
    // au-dessus : les deux rendraient la bonne couleur pour une heure isolée
    // et une couleur différente pour la journée.
    // ═════════════════════════════════════════════════════════════════════
    {
      const suites = [
        // un alizé qui monte, passe la limite, puis redescend dans la marge
        [12, 16, 19, 21, 26, 29, 26, 21, 19.5, 18.5, 17, 12],
        // un ciel qui hésite autour du seuil, une heure sur deux
        [19.9, 20.1, 19.9, 20.1, 19.9, 20.1, 19.9, 20.1],
        // tout bon
        [5, 6, 7, 8],
        // tout mauvais
        [40, 41, 39, 42]
      ];
      for (const type of Object.keys(B.SEUILS)) {
        for (const suite of suites) {
          const heures = suite.map((v, i) => ({
            t: '2026-08-29T' + String(i).padStart(2, '0') + ':00',
            vent: v, houle: 1.5, periode: 10
          }));
          const rb = B.analyser(heures, type);
          const ra = A.analyser(heures, type);
          const cb = rb.heures.map((x) => x.cat).join(',');
          const ca = ra.heures.map((x) => x.cat).join(',');
          if (cb !== ca) {
            fautes.push('`analyser` diverge sur ' + type + ' : backend [' + cb
              + '] contre application [' + ca + ']. L’hystérésis ne circule '
              + 'pas pareil des deux côtés.');
          }
          if (rb.cat !== ra.cat || rb.ferme !== ra.ferme || rb.ouvre !== ra.ouvre) {
            fautes.push('`analyser` diverge sur le résumé (' + type + ') : '
              + JSON.stringify({ cat: rb.cat, ferme: rb.ferme, ouvre: rb.ouvre })
              + ' contre '
              + JSON.stringify({ cat: ra.cat, ferme: ra.ferme, ouvre: ra.ouvre })
              + ' — c’est ce qui écrit « ça se ferme à 14 h »');
          }
        }
      }
      if (!fautes.length) {
        notes.push(suites.length + ' séquences de douze heures par type de spot : '
          + 'mêmes couleurs heure par heure, et même « ça se ferme à »');
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // ── 4. la différence connue, écrite pour qu'elle ne surprenne personne
    // ═════════════════════════════════════════════════════════════════════
    {
      let mB = null, mA = null;
      try { mB = B.categorie({ vent: 10 }, 'type-inexistant', null); }
      catch (e) { mB = 'lève une erreur'; }
      try { mA = A.categorie({ vent: 10 }, 'type-inexistant', null); }
      catch (e) { mA = 'lève une erreur'; }
      if (mB !== mA) {
        notes.push('différence connue et sans effet sur un type de spot inconnu : '
          + 'le backend ' + mB + ', l’application rend « ' + mA + ' ». Aucun '
          + 'spot n’a de type inventé ; si cela arrivait, le backend s’arrêterait '
          + 'bruyamment et l’application n’afficherait pas de couleur — les deux '
          + 'sont des échecs sûrs.');
      }
    }
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }

  return { notes, fautes };
};
