/**
 * La flèche par île ne sort que si le carnet la justifie.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTÈGE.
 *
 * La corrélation rend TOUJOURS un déplacement : c'est le maximum d'une
 * surface, et un maximum existe même dans du bruit. Les garde-fous de
 * `mesurerUneIle` écartent les cas manifestement faux, mais un ciel qui se
 * transforme peut passer une fois par accident.
 *
 * Ce qu'un accident ne reproduit pas, c'est la PERSISTANCE. `ilesPubliables`
 * ne demande donc pas « la dernière mesure est-elle bonne » mais « cette
 * île bouge-t-elle dans le même sens depuis deux heures ». C'est ce juge-là
 * que cet essai éprouve, sur des carnets fabriqués exprès.
 *
 * ⚠️  LES DEUX PIÈGES QUI NE SE VOIENT PAS À L'ÉCRAN.
 *
 * 1. LA FLÈCHE PÉRIMÉE. Une île qui a bien bougé pendant deux heures puis
 *    s'est mise à refuser ne doit plus rien afficher. Sans cette condition,
 *    elle garderait sa dernière flèche connue — une projection d'il y a une
 *    heure présentée comme celle de maintenant. À l'écran, elle aurait
 *    exactement l'air d'une flèche normale.
 *
 * 2. LA MOYENNE DE CAPS. 350° et 10° pointent tous deux vers le nord ; leur
 *    moyenne arithmétique vaut 180°, soit le SUD. Une île qui bouge vers le
 *    nord serait déclarée instable, ou pire, publiée avec un cap inversé.
 *    C'est une faute qu'on ne voit pas en relisant le code, seulement en
 *    l'essayant sur des chiffres qui enjambent le zéro.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const APP = path.resolve(RACINE, '..', 'matai-app');

module.exports = async function () {
  const fautes = [];
  const notes = [];

  const P = await import('file://' + path.join(RACINE, 'parile.mjs'));

  /** Fabrique un carnet : pour chaque passage, l'état de chaque île. */
  const carnet = (lignes) => lignes.map((iles, n) => ({
    instant: new Date(Date.UTC(2026, 7, 29, 0, n * 20)).toISOString(),
    iles
  }));
  const bouge = (id, cap, noeuds = 14) => ({ id, cap, noeuds, dispersion: 1, desaccord: 1 });
  const refuse = (id, r = 'ciel non uniforme dans la fenêtre') => ({ id, refus: r });

  // ═════════════════════════════════════════════════════════════════════
  // ── 1. la moyenne circulaire, sur des caps qui enjambent le nord
  // ═════════════════════════════════════════════════════════════════════
  {
    const cas = [
      [[350, 10, 0], 0, 10],
      [[355, 5], 0, 5],
      [[80, 100, 90], 90, 10],
      [[170, 190], 180, 10],
      [[270, 280, 260], 270, 10]
    ];
    for (const [caps, moyenVoulu, etendueVoulue] of cas) {
      const r = P.dispersionDesCaps(caps);
      let d = Math.abs(r.moyen - moyenVoulu) % 360;
      if (d > 180) d = 360 - d;
      if (d > 2) {
        fautes.push('moyenne de caps fausse sur [' + caps.join(', ') + '] : '
          + r.moyen + '° au lieu de ' + moyenVoulu + '° — une moyenne '
          + 'arithmétique sur des angles rend le sud pour deux caps au nord');
      }
      if (Math.abs(r.etendue - etendueVoulue) > 2) {
        fautes.push('étendue fausse sur [' + caps.join(', ') + '] : ' + r.etendue
          + '° au lieu de ' + etendueVoulue + '°');
      }
    }
    if (!fautes.length) notes.push('moyenne circulaire vérifiée sur 5 cas, dont deux qui enjambent le nord');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 2. une île qui bouge franchement depuis deux heures est publiée
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = carnet([
      [bouge('bora-bora', 95)], [bouge('bora-bora', 92)], [bouge('bora-bora', 99)],
      [bouge('bora-bora', 94)], [bouge('bora-bora', 97)], [bouge('bora-bora', 96)]
    ]);
    const r = P.ilesPubliables(c);
    if (r.publiables.length !== 1) {
      fautes.push('un alizé parfaitement régulier sur six passages n’est pas publié : '
        + JSON.stringify(r.ecartes));
    } else {
      const p = r.publiables[0];
      if (p.cap !== 96) {
        fautes.push('la flèche publiée devrait être la mesure LA PLUS RÉCENTE (96°), '
          + 'pas une moyenne : obtenu ' + p.cap + '°');
      }
      if (!p.confiance || p.confiance.mesures !== 6) {
        fautes.push('la confiance publiée ne compte pas les six mesures');
      }
      notes.push('alizé régulier → publié à ' + p.cap + '°, '
        + p.confiance.mesures + '/' + p.confiance.passages + ' passages, '
        + p.confiance.etendueCap + '° d’écart');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 3. ⚠️  LA FLÈCHE PÉRIMÉE : bonne pendant deux heures, puis plus rien
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = carnet([
      [bouge('tahiti', 95)], [bouge('tahiti', 92)], [bouge('tahiti', 99)],
      [bouge('tahiti', 94)], [bouge('tahiti', 97)], [refuse('tahiti')]
    ]);
    const r = P.ilesPubliables(c);
    if (r.publiables.length !== 0) {
      fautes.push('UNE ÎLE QUI NE MESURE PLUS RIEN AU DERNIER PASSAGE EST QUAND '
        + 'MÊME PUBLIÉE. Sa dernière flèche connue, vieille d’une heure, serait '
        + 'affichée comme celle de maintenant — et à l’écran elle aurait l’air '
        + 'parfaitement normale.');
    } else {
      const e = r.ecartes.find((x) => x.id === 'tahiti');
      if (!e || !/dernier passage/.test(e.raison)) {
        fautes.push('l’île est écartée mais pas pour la bonne raison : '
          + JSON.stringify(e));
      } else {
        notes.push('flèche périmée écartée : « ' + e.raison + ' »');
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 4. une direction qui part dans tous les sens n'est pas publiée
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = carnet([
      [bouge('moorea', 20)], [bouge('moorea', 200)], [bouge('moorea', 110)],
      [bouge('moorea', 300)], [bouge('moorea', 45)], [bouge('moorea', 240)]
    ]);
    const r = P.ilesPubliables(c);
    if (r.publiables.length !== 0) {
      fautes.push('SIX MESURES DANS SIX DIRECTIONS DIFFÉRENTES SONT PUBLIÉES. '
        + 'Chacune passe les garde-fous d’une mesure isolée ; c’est la '
        + 'persistance qui manque, et c’est justement ce que cette règle '
        + 'existe pour voir.');
    } else {
      notes.push('direction instable écartée : « '
        + r.ecartes.find((x) => x.id === 'moorea').raison + ' »');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 5. trop peu de mesures : on ne conclut pas
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = carnet([
      [refuse('gambier')], [refuse('gambier')], [refuse('gambier')],
      [refuse('gambier')], [bouge('gambier', 95)], [bouge('gambier', 96)]
    ]);
    const r = P.ilesPubliables(c);
    if (r.publiables.length !== 0) {
      fautes.push('deux mesures d’affilée suffisent à publier alors qu’il en faut '
        + P.ACCORDS_MIN + ' : une île qui vient de se réveiller n’a pas encore '
        + 'montré qu’elle était régulière');
    } else {
      notes.push('deux mesures seulement → écartée, il en faut ' + P.ACCORDS_MIN);
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 6. une vitesse qui saute du simple au quadruple n'est pas publiée
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = carnet([
      [bouge('rangiroa', 95, 6)], [bouge('rangiroa', 96, 34)], [bouge('rangiroa', 94, 9)],
      [bouge('rangiroa', 97, 41)], [bouge('rangiroa', 95, 7)], [bouge('rangiroa', 96, 38)]
    ]);
    const r = P.ilesPubliables(c);
    if (r.publiables.length !== 0) {
      fautes.push('une île qui alterne 6 et 40 nœuds d’un passage à l’autre est '
        + 'publiée : la direction est stable mais la mesure ne l’est pas');
    } else {
      notes.push('vitesse instable écartée : « '
        + r.ecartes.find((x) => x.id === 'rangiroa').raison + ' »');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 7. plusieurs îles à la fois, chacune jugée chez elle
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = carnet([
      [bouge('a', 95), bouge('b', 10), refuse('c')],
      [bouge('a', 92), bouge('b', 190), refuse('c')],
      [bouge('a', 99), bouge('b', 60), refuse('c')],
      [bouge('a', 94), bouge('b', 300), refuse('c')],
      [bouge('a', 97), bouge('b', 120), refuse('c')],
      [bouge('a', 96), bouge('b', 250), refuse('c')]
    ]);
    const r = P.ilesPubliables(c);
    const ids = r.publiables.map((x) => x.id).sort();
    if (ids.join(',') !== 'a') {
      fautes.push('trois îles, une seule régulière : publiées = [' + ids.join(', ')
        + '] au lieu de [a]');
    }
    if (r.ecartes.length !== 2) {
      fautes.push('les deux îles non publiables devraient être écartées AVEC leur '
        + 'raison — une île absente sans explication ressemble à une panne');
    } else {
      notes.push('trois îles jugées séparément : a publiée, b et c écartées avec leur raison');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 8. un carnet vide ne publie rien et n'explose pas
  // ═════════════════════════════════════════════════════════════════════
  {
    for (const vide of [[], null, undefined]) {
      const r = P.ilesPubliables(vide);
      if (r.publiables.length || r.ecartes.length) {
        fautes.push('un carnet vide rend quelque chose : ' + JSON.stringify(r));
      }
    }
    notes.push('carnet vide → rien publié, aucune erreur');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 9. le fichier réellement servi, et son étiquette de nature
  //
  // ⚠️  L'application REFUSE tout fichier dont `nature` n'est pas
  // « projection ». C'est ce qui empêche qu'une erreur de chemin serve un
  // jour de l'observation sous une étiquette de calcul. Le champ doit donc
  // exister ici, et la fonction qui l'écrit doit être celle que le build
  // appelle — pas une seconde copie qui divergerait en silence.
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = carnet([
      [bouge('bora-bora', 95), refuse('tahiti')],
      [bouge('bora-bora', 92), refuse('tahiti')],
      [bouge('bora-bora', 99), refuse('tahiti')],
      [bouge('bora-bora', 94), refuse('tahiti')],
      [bouge('bora-bora', 97), refuse('tahiti')],
      [bouge('bora-bora', 96), refuse('tahiti')]
    ]);
    const f = P.fabriquerProjectionIles(c, { 'bora-bora': 'Bora Bora', tahiti: 'Tahiti' });

    if (f.nature !== 'projection') {
      fautes.push('le fichier servi ne porte pas `nature: "projection"` — '
        + 'l’application le refusera, et la fonctionnalité entière sera muette '
        + 'sans qu’aucun essai ni aucun journal ne le dise');
    }
    if (!f.iles.length || f.iles[0].nom !== 'Bora Bora') {
      fautes.push('le fichier servi ne porte pas le nom lisible des îles : '
        + JSON.stringify(f.iles));
    }
    if (!f.ecartees.length || f.ecartees[0].nom !== 'Tahiti') {
      fautes.push('les îles écartées perdent leur nom, donc l’application ne peut '
        + 'pas dire de laquelle elle parle');
    }
    // Et il doit survivre à un aller-retour JSON — c'est sous cette forme
    // qu'il traverse le réseau.
    try {
      const relu = JSON.parse(JSON.stringify(f));
      if (relu.iles[0].confiance.mesures !== 6) {
        fautes.push('la confiance ne survit pas à la sérialisation JSON');
      }
    } catch (e) {
      fautes.push('le fichier servi n’est pas sérialisable : ' + e.message);
    }
    if (!fautes.length) {
      notes.push('fichier servi : nature « projection », 1 île nommée publiée, '
        + '1 écartée nommée, sérialisable');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 10. l'application étiquette la flèche comme une PROJECTION
  // ═════════════════════════════════════════════════════════════════════
  {
    const c = path.join(APP, 'src', 'composants', 'ProjectionIle.js');
    if (!fs.existsSync(c)) {
      notes.push('ProjectionIle.js absent de cet arbre : contrôle non fait');
    } else {
      const t = fs.readFileSync(c, 'utf8');
      if (!/Projection/i.test(t)) {
        fautes.push('ProjectionIle.js n’étiquette plus la flèche comme une '
          + 'projection : une flèche nue ressemble à une mesure de vent, et le '
          + 'point 8 du cahier des charges tient en une phrase — on distingue '
          + 'toujours l’observé, le prévu et le calculé');
      }
      if (!/etat === 'ecartee'|etat === "ecartee"/.test(t)) {
        fautes.push('ProjectionIle.js ne traite plus le cas « écartée » : une case '
          + 'vide ressemble à une panne, alors que « le ciel se transforme au lieu '
          + 'de se déplacer » est une information vraie');
      }
      if (!/pas le vent|n’est pas le vent/i.test(t)) {
        fautes.push('ProjectionIle.js ne prévient plus que ce n’est pas le vent du '
          + 'pont : les sommets de nuages avancent en altitude, souvent plus vite '
          + 'et pas toujours dans le même sens');
      }
      if (!fautes.length) {
        notes.push('l’application étiquette la flèche, traite les îles écartées, '
          + 'et prévient que ce n’est pas le vent de surface');
      }
    }
  }

  return { notes, fautes };
};
