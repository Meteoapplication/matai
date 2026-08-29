/**
 * La barre du bas, à la police que l'utilisateur a choisie.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTÈGE, ET POURQUOI IL N'EXISTAIT PAS.
 *
 * Constaté sur le téléphone de Gabin, le 29 août : dans la barre du bas,
 * « MESURES » était coupé en « MESURE » / « S », et le S venait chevaucher
 * « ACCUEIL ». Sur toutes les pages, en permanence.
 *
 * `tests/navigateur/etroit.js` existait justement pour ça. Il fait varier la
 * LARGEUR de l'écran sur quatre valeurs, de 320 à 412, et vérifie que rien
 * ne déborde. Il n'a rien vu — et il ne pouvait rien voir : ce n'était pas
 * la largeur.
 *
 * ⚠️  C'ÉTAIT L'AGRANDISSEMENT DE POLICE DU SYSTÈME.
 *
 * Android multiplie toutes les tailles de texte par le réglage
 * d'accessibilité de l'utilisateur — couramment 1,15, 1,3, parfois 2. Les
 * 9,5 pixels du libellé en font 12,4 à 1,3, et sept lettres majuscules ne
 * tiennent plus dans une case sur six. L'écran de développement est à 1,0 ;
 * l'essai de navigateur aussi. Personne ne regardait cet axe-là.
 *
 * C'est le même genre de trou que le carré noir de la nuit : un défaut
 * permanent, sous les yeux de tout le monde, invisible parce que l'endroit
 * d'où on regarde est toujours le même.
 *
 * Ce fichier mesure la largeur du texte au grossissement maximal autorisé et
 * la compare à la case disponible, sur le plancher Android. Il ne regarde
 * pas une capture : il calcule.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..', 'matai-app');

/** Le plancher Android, et un grand téléphone courant. */
const LARGEURS = [320, 360, 412];

/**
 * Largeur de chaque caractère, en fraction de la taille de police.
 *
 * ⚠️  UNE MOYENNE NE SUFFIT PAS, ET LE PREMIER JET L'A APPRIS.
 *
 * Écrit d'abord avec une largeur moyenne de 0,70 em pour toutes les lettres,
 * cet essai déclarait « ACCUEIL », « MESURES » et « 5 JOURS » trop larges à
 * l'identique — 55,3 px chacun. Ils font en réalité 4,27, 4,67 et 4,19 em :
 * « ACCUEIL » contient un I et un L, qui sont deux fois plus étroits qu'un M.
 * La moyenne écrasait justement la différence qui décide.
 *
 * Valeurs relevées sur Libre Franklin SemiBold. Elles n'ont pas besoin d'être
 * exactes au centième : elles doivent être ORDONNÉES correctement, ce qu'une
 * moyenne n'est jamais.
 */
const EM = {
  A: 0.70, C: 0.70, D: 0.75, E: 0.60, I: 0.28, J: 0.55, L: 0.56, M: 0.87,
  N: 0.79, O: 0.76, R: 0.67, S: 0.60, T: 0.61, U: 0.73, ' ': 0.26, '5': 0.62
};
/** Largeur d'un libellé, en em. Une lettre inconnue compte large. */
function largeurEm(mot) {
  let t = 0;
  for (const c of mot) t += (EM[c] !== undefined ? EM[c] : 0.80);
  return t;
}

module.exports = async function () {
  const fautes = [];
  const notes = [];

  const app = path.join(APP, 'App.js');
  if (!fs.existsSync(app)) {
    return { notes: ['App.js absent de cet arbre : contrôle non fait'], fautes };
  }
  const t = fs.readFileSync(app, 'utf8');

  // ═════════════════════════════════════════════════════════════════════
  // ── 1. les deux garde-fous sont posés sur le libellé
  // ═════════════════════════════════════════════════════════════════════
  // ═════════════════════════════════════════════════════════════════════
  // ⚠️  ON RETIRE LES COMMENTAIRES AVANT DE CHERCHER.
  //
  // Premier jet : ce contrôle lisait le bloc tel quel. Or le commentaire qui
  // explique le correctif contient les mots `numberOfLines={1}` et
  // `adjustsFontSizeToFit` — donc l'essai les trouvait dans sa propre
  // explication et passait au vert même après qu'on ait retiré les
  // attributs du JSX. Vérifié : les deux sabotages sont passés inaperçus.
  //
  // Un essai qui lit la documentation du code au lieu du code ne prouve
  // rien, et il est pire qu'absent : il rassure.
  // ═════════════════════════════════════════════════════════════════════
  const brut = t.slice(t.indexOf('<Icone id={o.id}'),
                       t.indexOf('</Pressable>', t.indexOf('<Icone id={o.id}')));
  const bloc = brut
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')   // commentaires JSX
    .replace(/\/\*[\s\S]*?\*\//g, ' ')                 // commentaires de bloc
    .replace(/\/\/[^\n]*/g, ' ');                       // commentaires de ligne

  if (!/numberOfLines=\{1\}/.test(bloc)) {
    fautes.push('le libellé d’onglet n’a plus `numberOfLines={1}` : c’est la '
      + 'garantie DURE qu’il ne passe jamais à la ligne. Sans elle, « MESURES » '
      + 'se coupe en « MESURE » / « S » et le S chevauche « ACCUEIL » — sur '
      + 'toutes les pages, en permanence, pour tout utilisateur ayant agrandi '
      + 'la police de son téléphone.');
  }

  const plafond = /maxFontSizeMultiplier=\{([\d.]+)\}/.exec(bloc);
  if (!plafond) {
    fautes.push('le libellé d’onglet n’a plus de plafond de grossissement : à '
      + '2× (un réglage d’accessibilité courant) il déborde de sa case');
  } else if (Number(plafond[1]) > 1.4) {
    fautes.push('plafond de grossissement à ' + plafond[1] + ' : trop haut pour '
      + 'six onglets sur un écran de 320 px');
  }

  // On ne coupe pas l'accessibilité, on la borne : un plafond à 1 revient à
  // ignorer le réglage de l'utilisateur.
  if (plafond && Number(plafond[1]) <= 1.0) {
    fautes.push('plafond de grossissement à ' + plafond[1] + ' : cela ANNULE le '
      + 'réglage d’accessibilité au lieu de le borner. Quelqu’un qui a agrandi '
      + 'la police de son téléphone l’a fait pour une raison.');
  }
  if (/allowFontScaling=\{false\}/.test(bloc)) {
    fautes.push('`allowFontScaling={false}` sur le libellé d’onglet : le texte '
      + 'ne suivra plus du tout le réglage d’accessibilité. Le plafond suffit.');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 2. et on MESURE : ça tient, au grossissement maximal
  // ═════════════════════════════════════════════════════════════════════
  const taille = /ongletTxt:\s*\{[^}]*fontSize:\s*([\d.]+)/.exec(t);
  const inter = /ongletTxt:\s*\{[^}]*letterSpacing:\s*([\d.]+)/.exec(t);
  const marge = /barre:\s*\{[^}]*paddingHorizontal:\s*(\d+)/.exec(t);

  if (!taille) {
    fautes.push('taille du libellé d’onglet introuvable dans les styles');
  } else {
    const px = Number(taille[1]);
    const ls = inter ? Number(inter[1]) : 0;
    const pad = marge ? Number(marge[1]) : 0;
    const mult = plafond ? Number(plafond[1]) : 1;

    // Les libellés réellement affichés.
    const libelles = [...t.matchAll(/\{\s*id:\s*'[^']+',\s*nom:\s*'([^']+)'\s*\}/g)]
      .map((m) => m[1]);
    if (libelles.length < 5) {
      fautes.push('libellés d’onglets introuvables : ' + JSON.stringify(libelles));
    }

    const dessine = (nom, m) => largeurEm(nom) * px * m + ls * (nom.length - 1);
    const pire = libelles.reduce((a, b) =>
      (largeurEm(b) > largeurEm(a) ? b : a));

    // ── à taille NORMALE, tout doit tenir partout. C'est le contrat de base :
    //    si ça ne tient pas ici, la barre est cassée pour tout le monde.
    const lignes = [];
    for (const L of LARGEURS) {
      const boite = (L - 2 * pad) / libelles.length;
      for (const nom of libelles) {
        const w = dessine(nom, 1);
        if (w > boite) {
          fautes.push('À TAILLE NORMALE, « ' + nom + ' » demande ' + w.toFixed(1)
            + ' px dans une case de ' + boite.toFixed(1) + ' px sur un écran de '
            + L + ' px. La barre est cassée pour tout le monde, pas seulement '
            + 'pour qui a agrandi sa police.');
        }
      }
      lignes.push(L + ' px → case ' + boite.toFixed(0) + ' px, « ' + pire + ' » '
        + dessine(pire, 1).toFixed(0) + ' px');
    }

    // ── au grossissement maximal, on ne DOIT plus tenir partout : on doit
    //    seulement ne jamais casser. C'est `adjustsFontSizeToFit` qui prend le
    //    relais en rétrécissant, et `numberOfLines` qui interdit la deuxième
    //    ligne. On consigne à partir de quelle largeur le rétrécissement
    //    commence, pour que ce compromis soit un chiffre connu et pas une
    //    surprise.
    if (!/adjustsFontSizeToFit/.test(bloc)) {
      fautes.push('le libellé n’a pas `adjustsFontSizeToFit` : au-delà du '
        + 'plafond il serait COUPÉ par des points de suspension au lieu d’être '
        + 'rétréci. « MESUR… » n’apprend rien à personne.');
    }
    const serre = LARGEURS.filter((L) =>
      dessine(pire, mult) > (L - 2 * pad) / libelles.length);
    if (serre.length) {
      notes.push('à ' + mult + '× de grossissement, « ' + pire + ' » est rétréci '
        + 'pour tenir sur les écrans de ' + serre.join(' et ') + ' px — jamais '
        + 'coupé ni passé à la ligne');
    }

    if (!fautes.length) {
      notes.push(libelles.length + ' onglets à ' + px + ' px, largeurs réelles '
        + 'des lettres : ' + lignes.join(' · '));
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── 3. l'essai de navigateur doit dire qu'il ne couvre PAS cet axe
  //
  // Il a existé pendant tout ce temps en donnant l'impression que la barre
  // était éprouvée. Une limite connue et écrite vaut mieux qu'une confiance
  // mal placée — c'est ce qui a laissé passer ce défaut.
  // ═════════════════════════════════════════════════════════════════════
  {
    const e = path.join(__dirname, 'navigateur', 'etroit.js');
    if (fs.existsSync(e)) {
      const x = fs.readFileSync(e, 'utf8');
      if (!/police|grossissement|fontScale/i.test(x)) {
        fautes.push('tests/navigateur/etroit.js ne dit toujours pas qu’il ne '
          + 'couvre que la LARGEUR et pas l’agrandissement de police. Il a '
          + 'donné pendant des semaines l’impression que la barre était '
          + 'éprouvée, alors qu’il regardait le mauvais axe.');
      } else {
        notes.push('etroit.js dit maintenant quel axe il ne couvre pas');
      }
    }
  }

  return { notes, fautes };
};
