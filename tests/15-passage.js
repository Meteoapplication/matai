/**
 * Trente heures de site figé pour un point sur vingt et un.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Ce test garde une seule règle, et elle a un coût mesuré.
 *
 * `build.mjs` finissait par :
 *
 *     if (echecs > 0) process.exitCode = 1;
 *
 * L'intention est bonne — « mieux vaut vieux que faux » — mais elle a été
 * appliquée à la mauvaise chose. Vingt et un points sont interrogés un par
 * un. Un seul sans réponse, et la fabrication sortait en échec ; le pas du
 * flux GitHub qui publie ne s'exécutait donc pas.
 *
 * Ce n'est pas « on saute une heure ». Le site reste figé à la dernière
 * fois où les vingt et un points ont tous répondu du premier coup. Le
 * 28 août 2026, il servait encore le paquet du 26 à 19 h 53 : trente heures
 * d'immobilité, pendant lesquelles l'application affichait à tout le monde
 * une prévision périmée, pour une seconde de réseau sur un point.
 *
 * ⚠️  ET LA RÈGLE INVERSE SERAIT AUSSI FAUSSE.
 *
 * « Publier quoi qu'il arrive » écraserait un site correct par un dossier
 * vide le jour où Open-Meteo est en panne. La ligne juste passe entre les
 * deux, et c'est elle qu'on vérifie ici :
 *
 *     aucune île écrite → échec, on ne publie rien
 *     au moins une île → succès, on publie ce qui est bon
 *
 * ⚠️  POURQUOI CE FICHIER NE LANCE PAS `build.mjs`.
 *
 * Il faudrait le réseau, deux minutes, et une façon de faire tomber un
 * point exprès. La règle vit donc dans son propre module — `passage.mjs` —
 * où elle s'éprouve en une milliseconde et où son histoire est écrite à
 * côté d'elle. C'est la même raison qui a sorti les fuseaux dans
 * `src/fuseau.js` : une règle recopiée dans un script de six cents lignes
 * n'est jamais relue.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { charger, aLApp, React, TR } = require('./harnais');

/** Le texte rendu par un arbre react-test-renderer, à plat. */
function mots(n, out = []) {
  if (n === null || n === undefined) return out;
  if (typeof n === 'string') { out.push(n); return out; }
  if (Array.isArray(n)) { for (const x of n) mots(x, out); return out; }
  if (n.children) mots(n.children, out);
  return out;
}

module.exports = async function () {
  const P = await import(
    'file://' + path.resolve(__dirname, '..', 'passage.mjs')
  );

  const fautes = [];
  const notes = [];

  const CAS = [
    // description,                          entrée,                                    code attendu
    ['les 21 points répondent',              { ilesPubliees: 9, perdus: [] },            0],
    ['un point sur 21 est tombé',            { ilesPubliees: 9, perdus: ['x'] },         0],
    ['cinq points tombés, 9 îles écrites',   { ilesPubliees: 9, perdus: [1,2,3,4,5] },   0],
    ['une seule île a pu être fabriquée',    { ilesPubliees: 1, perdus: [1,2,3] },       0],
    ['panne totale : aucune île',            { ilesPubliees: 0, perdus: [1,2,3] },       1],
    ['aucune île et aucun point tombé',      { ilesPubliees: 0, perdus: [] },            1],
    ['mode vérification, rien n’est écrit',  { ilesPubliees: 0, perdus: [], verif: true }, 0],
    ['appel sans argument',                  undefined,                                  1]
  ];

  for (const [quoi, entree, attendu] of CAS) {
    let r;
    try {
      r = P.verdictDePassage(entree);
    } catch (e) {
      fautes.push(quoi + ' : la règle a planté — ' + e.message);
      continue;
    }
    if (!r || typeof r.code !== 'number') {
      fautes.push(quoi + ' : pas de code de sortie rendu');
      continue;
    }
    if (r.code !== attendu) {
      fautes.push(quoi + ' : code ' + r.code + ' au lieu de ' + attendu
        + (attendu === 0
          ? ' — un passage qui a produit des paquets ne doit PAS bloquer la publication'
          : ' — un passage qui n’a rien produit ne doit PAS publier'));
    }
  }
  notes.push(CAS.length + ' cas de code de sortie vérifiés');

  // ── un point tombé ne disparaît jamais en silence
  const avecPertes = P.verdictDePassage({
    ilesPubliees: 9,
    perdus: ['Bora Bora / Passe Teavanui — HTTP 502']
  });
  const dit = avecPertes.lignes.join('\n');
  if (!/Passe Teavanui/.test(dit)) {
    fautes.push('le point tombé n’est pas nommé dans le journal du passage');
  }
  if (!/sans réponse/.test(dit)) {
    fautes.push('le journal ne dit pas que des points sont restés sans réponse');
  }

  // ── et un passage parfait ne raconte rien
  const parfait = P.verdictDePassage({ ilesPubliees: 9, perdus: [] });
  if (parfait.lignes.length) {
    fautes.push('un passage sans incident écrit quand même ' + parfait.lignes.length
      + ' ligne(s) : le journal doit rester silencieux quand tout va bien');
  }
  notes.push('les points tombés sont nommés, un passage propre reste muet');

  // ═══════════════════════════════════════════════════════════════════════
  // ET LA LIGNE FAUTIVE NE DOIT PAS REVENIR DANS build.mjs.
  //
  // La règle est sortie dans son module, mais rien n'empêche quelqu'un de
  // rétablir un jour un `process.exitCode = 1` sur le compte des échecs
  // dans la boucle des points — ce qui reproduirait exactement la panne,
  // sans que ce test s'en aperçoive puisqu'il n'éprouve que le module.
  // ═══════════════════════════════════════════════════════════════════════
  const build = fs.readFileSync(path.resolve(__dirname, '..', 'build.mjs'), 'utf8');
  const sansCommentaires = build
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  if (/echecs\s*>\s*0[\s\S]{0,40}exitCode/.test(sansCommentaires)) {
    fautes.push('build.mjs fait de nouveau échouer le passage sur le nombre '
      + 'd’échecs de points — c’est la ligne qui a figé le site trente heures');
  }
  if (!/verdictDePassage/.test(sansCommentaires)) {
    fautes.push('build.mjs n’appelle plus verdictDePassage : la règle n’est '
      + 'plus celle qu’on vérifie ici');
  }
  notes.push('build.mjs relu : il délègue la décision et ne la reprend pas');

  // ═══════════════════════════════════════════════════════════════════════
  // L'AUTRE MOITIÉ DE LA RÈGLE : L'ÉCRAN DOIT LE DIRE.
  //
  // Publier une île à qui il manque un point est le bon choix — mais
  // seulement s'il se voit. Sinon on a remplacé une panne visible (le site
  // figé) par une absence silencieuse (une passe qui n'est plus dans la
  // liste, et rien qui l'explique), ce qui est le mauvais côté du marché.
  //
  // Le backend écrit `manquants` dans le paquet ; la barre de fraîcheur le
  // dit. Les deux bouts sont éprouvés ici, dans le fichier de la règle.
  // ═══════════════════════════════════════════════════════════════════════
  if (aLApp()) {
    const Barre = charger('composants/Fraicheur').default;
    const rendre = (paquet) => {
      const a = TR.create(React.createElement(Barre, { paquet }));
      const t = mots(a.toJSON()).join(' ');
      a.unmount();
      return t;
    };

    const base = { majReelle: '2026-08-28T04:00:00Z', prochaine: '2026-08-28T05:00:00Z' };

    const propre = rendre(base);
    if (/n’a pas répondu|n’ont pas répondu/.test(propre)) {
      fautes.push('un paquet complet annonce quand même des points manquants');
    }

    const un = rendre({ ...base, manquants: ['teavanui'] });
    if (!/Un point de mesure n’a pas répondu/.test(un)) {
      fautes.push('un point manquant ne se voit pas dans la barre de fraîcheur');
    }

    const trois = rendre({ ...base, manquants: ['a', 'b', 'c'] });
    if (!/3 points de mesure n’ont pas répondu/.test(trois)) {
      fautes.push('le nombre de points manquants est faux ou l’accord ne suit pas');
    }

    // ⚠️  `manquants` vient du réseau : ce n'est pas forcément un tableau.
    for (const abime of ['oui', 3, {}, null]) {
      let t;
      try {
        t = rendre({ ...base, manquants: abime });
      } catch (e) {
        fautes.push('un champ « manquants » valant ' + JSON.stringify(abime)
          + ' fait planter la barre : ' + e.message);
        continue;
      }
      if (/n’a pas répondu|n’ont pas répondu|undefined|NaN/.test(t)) {
        fautes.push('un champ « manquants » valant ' + JSON.stringify(abime)
          + ' a produit une annonce : « ' + t.trim().slice(0, 80) + ' »');
      }
    }
    notes.push('la barre de fraîcheur dit les points manquants, et se tait sur un champ abîmé');

    // ═══════════════════════════════════════════════════════════════════
    // ⚠️  ET UNE HEURE SANS SON JOUR EST UNE HEURE QUI MENT.
    //
    // Ces trente heures de site figé ont révélé un second défaut, dans le
    // composant même qui existe pour dire depuis quand : la barre écrivait
    // « Mise à jour à 09 h 53 » sans jamais dire quel jour. Le 28 août, sur
    // un paquet du 26, elle affichait donc « Mise à jour à 09 h 53 » en
    // haut de chaque écran — et « 09 h 53 » un matin veut dire ce matin.
    //
    // Deux jours de prévision périmée présentés comme les nouvelles du
    // jour. Le jour ne s'écrit que lorsqu'il n'est pas aujourd'hui, et il
    // se compte dans le fuseau de l'île.
    // ═══════════════════════════════════════════════════════════════════
    const T = Date.parse('2026-08-28T20:00:00Z');   // 10 h du matin à Tahiti
    const quand = (iso, dec = -10) => {
      const a = TR.create(React.createElement(Barre, {
        paquet: { majReelle: iso }, decalageH: dec, maintenant: T
      }));
      const t = mots(a.toJSON()).join('');
      a.unmount();
      return t.replace(/\s+/g, ' ').trim();
    };

    const JOURS = [
      ['ce matin même',            '2026-08-28T19:40:00Z', -10, /à 09 h 40/,          /hier|le \d/],
      ['hier en heure de Tahiti',  '2026-08-27T19:53:00Z', -10, /hier à 09 h 53/,     null],
      ['le paquet figé du 26',     '2026-08-26T19:53:47Z', -10, /le 26 août à 09 h 53/, null],
      ['il y a cinq jours',        '2026-08-23T19:53:00Z', -10, /le 23 août/,         null],
      ['hier aux Gambier (−9 h)',  '2026-08-27T14:30:00Z',  -9, /hier à 05 h 30/,     null]
    ];
    for (const [quoi, iso, dec, attendu, interdit] of JOURS) {
      const t = quand(iso, dec);
      if (!attendu.test(t)) {
        fautes.push(quoi + ' : la barre dit « ' + t + " » — attendu " + attendu);
      }
      if (interdit && interdit.test(t)) {
        fautes.push(quoi + ' : la barre date un paquet du jour même — « ' + t + ' »');
      }
    }
    notes.push(JOURS.length + ' cas de datation vérifiés, dont le paquet figé du 26 août');
  }

  return { notes, fautes };
};
