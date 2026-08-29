/**
 * Ce que l'écran dit, et ce qu'il arrête de dire.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE.
 *
 * Les autres essais vérifient que l'application ne MENT pas. Celui-ci
 * vérifie qu'elle se laisse LIRE — ce qui n'est pas la même chose, et se
 * casse tout aussi silencieusement.
 *
 * Quatre corrections du 29 août, dont chacune peut être défaite par
 * quelqu'un qui croit bien faire :
 *
 *   1. LE BANDEAU NE BAVARDE PLUS. « Prochaine vérification à 17 h 00 » et
 *      « N vérifications sans données neuves » s'affichaient en permanence,
 *      sur tous les écrans. Deux phrases vraies, écrites pour de bonnes
 *      raisons, mais qui font parler l'application de son ménage. Elles ne
 *      sortent plus que quand la donnée est assez vieille pour qu'on se
 *      demande si quelque chose est cassé.
 *
 *   2. LE GRAPHIQUE DU VENT DIT LE VENT. Il colorait ses barres avec le
 *      verdict GLOBAL — vent, houle et période mêlés. À Bora Bora le
 *      29 août, douze barres rouges à cause d'une houle de 2,8 m, sous un
 *      titre annonçant « le vent ». Le vent, lui, n'était pas le problème.
 *
 *   3. LA VIGILANCE N'EST PLUS DOUBLE. Bandeau fixe en haut + répétition en
 *      bas de SORTIE. Une information de sécurité répétée pèse moins : la
 *      seconde occurrence apprend au lecteur que la première n'était pas
 *      importante.
 *
 *   4. CE QUE PERSONNE D'AUTRE NE DIT EST REMONTÉ. Le courant de la passe
 *      ne vient d'aucun modèle météo — il se déduit du régime de marée de
 *      l'archipel croisé avec la houle. C'était au sixième onglet.
 *
 * ⚠️  ET UNE CINQUIÈME, QUI EST UNE ERREUR DE MA PART, CONSERVÉE ICI.
 *
 * J'avais conseillé d'aplatir le fond de l'écran d'accueil, jugé « comme
 * toutes les applications météo » — sur une capture d'écran, sans lire
 * `Decor.js`. Or ce fond est calculé : hauteur réelle du soleil ici et à
 * cette minute, voile de nuages du code du temps, disque qui devient la
 * lune au coucher, étoiles à la nuit nautique. C'est l'inverse d'une
 * décoration, et le supprimer aurait détruit la meilleure idée de
 * l'application.
 *
 * Cet essai exige donc que le fond calculé RESTE, et que l'écran le dise.
 * Un jugement porté sur une capture d'écran ne vaut pas lecture du code.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..', 'matai-app');
const SRC = path.join(APP, 'src');

/** Lit un fichier de l'app, ou null s'il est absent de cet arbre. */
function lire(...bouts) {
  const p = path.join(SRC, ...bouts);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/** Retire les commentaires : un essai ne doit pas lire sa propre explication. */
function sansCommentaires(t) {
  return String(t)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

module.exports = async function () {
  const fautes = [];
  const notes = [];

  if (!fs.existsSync(SRC)) {
    return { notes: ['matai-app absent de cet arbre : contrôle non fait'], fautes };
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 1. le bandeau de fraîcheur se tait quand tout va bien
  // ═════════════════════════════════════════════════════════════════════
  {
    const brut = lire('composants', 'Fraicheur.js');
    if (!brut) {
      notes.push('Fraicheur.js absent : contrôle 1 non fait');
    } else {
      const t = sansCommentaires(brut);

      // Le seuil doit exister et être une durée, pas un interrupteur.
      const seuil = /ageMin\s*>\s*(\d+)/.exec(t);
      if (!seuil) {
        fautes.push('le bandeau de fraîcheur n’a plus de seuil d’âge : soit il '
          + 'redit en permanence « prochaine vérification à » et « N vérifications '
          + 'sans données neuves » sur tous les écrans, soit il ne le dit plus '
          + 'jamais — et les deux sont mauvais');
      } else if (Number(seuil[1]) < 20) {
        fautes.push('seuil d’âge à ' + seuil[1] + ' minutes : le flux passe toutes '
          + 'les vingt minutes, donc la barre redeviendrait bavarde en permanence');
      }

      for (const [quoi, motif] of [
        ['prochaine vérification', /\{\s*bavard\s*&&\s*hProchaine/],
        ['le compteur de républications', /\{\s*bavard\s*&&\s*republie/]
      ]) {
        if (!motif.test(t)) {
          fautes.push(quoi + ' n’est plus conditionné à l’âge de la donnée : '
            + 'il repasse en permanence en haut de tous les écrans');
        }
      }

      // ⚠️  Mais l'heure de mise à jour, elle, ne doit JAMAIS disparaître.
      // C'est la règle d'honnêteté du projet, et « faire moins bavard » est
      // exactement le genre de nettoyage qui l'emporterait au passage.
      if (!/Mise à jour|quandMaj/.test(t)) {
        fautes.push('L’HEURE DE MISE À JOUR A DISPARU du bandeau. Alléger la '
          + 'barre ne doit jamais coûter la seule ligne qui dit l’âge réel de '
          + 'ce qui est affiché — c’est la règle que tout le projet applique.');
      }
      // Les points manquants restent affichés quoi qu'il arrive : c'est un
      // trou dans la donnée, pas du bavardage.
      if (!/manquants\s*>\s*0/.test(t)) {
        fautes.push('l’avertissement « un point de mesure n’a pas répondu » a '
          + 'disparu : c’est une donnée absente, pas du bavardage');
      }
      if (/\{\s*bavard\s*&&\s*manquants/.test(t)) {
        fautes.push('l’avertissement des points manquants a été mis derrière le '
          + 'seuil d’âge : une mesure absente doit se voir tout de suite');
      }
      if (!fautes.length) notes.push('bandeau : silencieux sous ' + seuil[1]
        + ' min, l’heure de mise à jour et les points manquants restent toujours affichés');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 2. ⚠️  le graphique du vent est coloré par LE VENT
  // ═════════════════════════════════════════════════════════════════════
  {
    const brut = lire('composants', 'Briques.js');
    if (!brut) {
      notes.push('Briques.js absent : contrôle 2 non fait');
    } else {
      const i = brut.indexOf('export function BarresVent');
      const bloc = sansCommentaires(brut.slice(i, brut.indexOf('export function', i + 10)));

      if (/couleurCat\s*\(/.test(bloc)) {
        fautes.push('LE GRAPHIQUE DU VENT EST À NOUVEAU COLORÉ PAR LE VERDICT '
          + 'GLOBAL (`couleurCat`), qui mêle vent, houle et période. Relevé à '
          + 'Bora Bora le 29 août : douze barres rouges à cause d’une houle de '
          + '2,8 m, sous un titre qui annonce « le vent ». Quelqu’un en conclut '
          + 'que le vent est mauvais alors qu’il ne l’était pas.');
      }
      if (!/ventLimite/.test(bloc) || !/ventOk/.test(bloc)) {
        fautes.push('le graphique n’utilise plus les seuils de VENT : sa couleur '
          + 'ne peut plus décrire ce que son titre annonce');
      }
      // L'échelle doit être écrite à l'écran, pas cachée dans le code.
      if (!/\{haut\}/.test(bloc)) {
        fautes.push('l’échelle du graphique n’est plus affichée : une barre « aux '
          + 'trois quarts » d’un maximum invisible ne veut rien dire');
      }
      if (!/bSeuil/.test(bloc)) {
        fautes.push('le trait du seuil a disparu : c’est lui qui permet de voir '
          + 'd’un coup d’œil si ça dépasse, et quand');
      }
      if (!/bResume/.test(bloc)) {
        fautes.push('les chiffres écrits (maintenant, et le pic avec son heure) '
          + 'ont disparu : on décide au nœud près, et une silhouette ne se lit '
          + 'pas au nœud près');
      }
      // Une échelle qui ne part pas de zéro exagère deux nœuds en coup de vent.
      if (!/Math\.max\(3,\s*Math\.min\(100/.test(bloc) && !/\/ haut\b/.test(bloc)) {
        fautes.push('les hauteurs ne sont plus une fraction d’une échelle partant '
          + 'de zéro : un écart de deux nœuds prendrait l’allure d’un coup de vent');
      }
      if (!fautes.length) notes.push('graphique du vent : couleur par le vent seul, '
        + 'échelle écrite, trait au seuil, et les deux chiffres qui décident');

      // Et l'appelant doit passer les seuils du bon type de spot.
      const sortie = sansCommentaires(lire('ecrans', 'Sortie.js') || '');
      if (sortie && !/BarresVent[^>]*seuils=\{SEUILS\[/.test(sortie)) {
        fautes.push('Sortie.js ne passe plus les seuils du type de spot au '
          + 'graphique : une passe devient difficile à 25 nœuds là où un lagon '
          + 'tient jusqu’à 28, donc le trait serait tracé au mauvais endroit');
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 3. la vigilance une seule fois par page
  // ═════════════════════════════════════════════════════════════════════
  {
    const brut = lire('ecrans', 'Sortie.js');
    if (!brut) {
      notes.push('Sortie.js absent : contrôle 3 non fait');
    } else {
      const t = sansCommentaires(brut);
      if (/<Vigilance\b/.test(t)) {
        fautes.push('SORTIE affiche à nouveau la vigilance en bas, alors qu’elle '
          + 'est déjà dans le bandeau fixe en haut de tous les écrans. Répétée, '
          + 'elle pèse moins : la seconde occurrence apprend au lecteur que la '
          + 'première n’était pas importante.');
      } else {
        notes.push('la vigilance n’est plus affichée deux fois sur la page SORTIE');
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 4. le courant de la passe est remonté sur l'accueil
  // ═════════════════════════════════════════════════════════════════════
  {
    const brut = lire('ecrans', 'Aujourdhui.js');
    if (!brut) {
      notes.push('Aujourdhui.js absent : contrôle 4 non fait');
    } else {
      const t = sansCommentaires(brut);
      if (!/risquePasse\s*\(/.test(t)) {
        fautes.push('l’accueil ne calcule plus le courant de la passe : la seule '
          + 'chose qu’aucune application internationale ne donne est retournée au '
          + 'sixième onglet, derrière trois écrans de chiffres qu’on trouve partout');
      }
      // ⚠️  Et seulement quand ça engage une décision.
      if (!/'mid'|"mid"/.test(t) || !/'no'|"no"/.test(t)) {
        fautes.push('le filtre sur le niveau a sauté : une ligne « la passe est '
          + 'calme » affichée en permanence ne serait plus lue le jour où elle '
          + 'ne l’est pas');
      }
      // Le verdict du lagon ne doit pas avoir été remplacé par celui de la passe.
      if (!/spotPour\(ile, 'lagon'\)/.test(t)) {
        fautes.push('LE VERDICT DE L’ACCUEIL N’EST PLUS CELUI DU LAGON. La passe '
          + 'a sa carte à elle ; elle ne doit pas prendre la place du verdict, '
          + 'car quelqu’un qui se baigne n’a rien à faire du courant de la passe.');
      }
      if (!fautes.length) notes.push('le courant de la passe est sur l’accueil, '
        + 'sous le verdict du lagon et seulement quand il engage une décision');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 5. ⚠️  LE CIEL CALCULÉ RESTE, ET L'ÉCRAN LE DIT
  // ═════════════════════════════════════════════════════════════════════
  {
    const brut = lire('ecrans', 'Aujourdhui.js');
    const decor = lire('composants', 'Decor.js');
    if (!brut || !decor) {
      notes.push('Aujourdhui.js ou Decor.js absent : contrôle 5 non fait');
    } else {
      const t = sansCommentaires(brut);
      if (!/<Decor\b/.test(t)) {
        fautes.push('LE FOND CALCULÉ A ÉTÉ RETIRÉ DE L’ACCUEIL. Ce n’est pas un '
          + 'dégradé décoratif : la couleur vient de la hauteur réelle du soleil '
          + 'ici et à cette minute, le voile de nuages du code du temps, le disque '
          + 'devient la lune au coucher, les étoiles sortent à la nuit nautique. '
          + 'C’est la seule chose de cette application qui montre LE ciel de celui '
          + 'qui la tient. Jugé sur une capture d’écran il ressemble à ce que fait '
          + 'toute la concurrence ; c’en est l’exact inverse.');
      }
      if (!/signature/.test(t)) {
        fautes.push('l’écran ne dit plus que son fond est calculé. Sans cette '
          + 'ligne, personne ne peut le deviner — et ce qui ne se devine pas ne '
          + 'compte pas comme une différence.');
      }
      if (!fautes.length) notes.push('le ciel calculé est en place, et l’écran dit qu’il est vrai');
    }
  }

  return { notes, fautes };
};
