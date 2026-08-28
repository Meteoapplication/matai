/**
 * La carte du ciel mangeait l'écran d'accueil.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  UN CONTENEUR QUI SE MESURE POUR DIMENSIONNER SON PROPRE CONTENU
 *     NE CONVERGE PAS.
 *
 * L'écran d'accueil voulait bien faire. Plutôt que de deviner la place qui
 * reste sous le bloc du haut, il la MESURAIT :
 *
 *     const [hMesuree, setHMesuree] = useState(null);
 *     const hCarte = hMesuree || Math.max(200, ecran.height - 430);
 *     …
 *     <View onLayout={(e) => setHMesuree(e.nativeEvent.layout.height)}>
 *       <CielRegional hauteur={hCarte} />
 *
 * L'intention est bonne — une hauteur en dur devient fausse à chaque fois
 * qu'on ajoute quelque chose au-dessus. Mais lis la boucle :
 *
 *   · le conteneur mesure sa hauteur ;
 *   · on la passe à l'enfant comme HAUTEUR D'IMAGE ;
 *   · la hauteur du conteneur, c'est cette image PLUS l'en-tête du bloc
 *     (« Le ciel sur la Polynésie » et son âge) PLUS les marges du cadre.
 *
 * Donc à chaque passe de mise en page :
 *
 *     hCarte(n+1) = hCarte(n) + en-tête + marges
 *
 * Ça ne converge jamais. La carte grandit d'une vingtaine de points à
 * chaque passe. Et quand l'avertissement « trop ancienne pour lire un
 * déplacement » s'insère au-dessus de l'image — c'est-à-dire dès que le
 * satellite a plus de deux heures, donc souvent — elle grandit encore plus
 * vite.
 *
 * Relevé sur un vrai téléphone le 28 août 2026 : une image qui occupait les
 * deux tiers de l'écran d'accueil, poussant tout le reste hors de vue.
 *
 * ⚠️  POURQUOI AUCUN ESSAI NE POUVAIT LE VOIR.
 *
 * Le banc monte les écrans et lit leur TEXTE. Il vérifiait donc qu'aucun
 * « null » n'atteint l'écran, qu'aucun zéro n'est inventé — et il avait
 * raison sur tout ça. Mais une mise en page qui enfle n'écrit rien de faux :
 * tous les mots sont justes, ils sont simplement au mauvais endroit et à la
 * mauvaise taille. Il fallait mesurer une HAUTEUR, pas relire des mots.
 *
 * D'où ce fichier. Il ne lit aucun texte : il regarde ce que les styles
 * demandent comme place.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { charger, monter, aLApp, sansCommentaires } = require('./harnais');

/**
 * Plafond de hauteur pour un bloc de l'accueil, en points.
 *
 * Un téléphone courant fait entre 700 et 900 points de haut. 380 laisse à
 * la carte un peu moins de la moitié de l'écran — assez pour y lire quelque
 * chose, pas assez pour chasser le reste. La valeur saine calculée par le
 * code corrigé, aux proportions de l'image régionale (1233 × 1068), tourne
 * autour de 300.
 */
const PLAFOND = 380;

/** Toutes les hauteurs explicites demandées par les styles de l'arbre. */
function hauteurs(n, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { for (const x of n) hauteurs(x, out); return out; }

  const st = n.props && n.props.style;
  const plat = Array.isArray(st) ? st : (st ? [st] : []);
  for (const s of plat) {
    if (s && typeof s.height === 'number') out.push(s.height);
  }
  if (n.children) hauteurs(n.children, out);
  return out;
}

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const source = path.resolve(__dirname, '..', 'paquets', 'bora-bora.json');
  if (!fs.existsSync(source)) {
    return { saute: 'aucun paquet sous la main (lancer « npm run demo » d’abord)' };
  }

  const fautes = [];
  const notes = [];

  const Aujourdhui = charger('ecrans/Aujourdhui').default;
  const paquet = JSON.parse(fs.readFileSync(source, 'utf8'));
  paquet.ile = paquet.ile || 'bora-bora';

  const props = {
    ile: paquet, iles: [], position: null, animation: null,
    fraicheurTexte: 'il y a 20 min', surPlace: true, plein: false,
    onChangerIle() {}, onPlein() {}, onDetail() {}
  };

  // ── ce que l'écran demande comme place
  let arbre;
  try {
    arbre = monter(Aujourdhui, props);
  } catch (e) {
    fautes.push('l’écran d’accueil ne se monte plus : ' + e.message);
    return { notes, fautes };
  }

  const hs = hauteurs(arbre);
  const pire = hs.length ? Math.max(...hs) : 0;

  if (pire > PLAFOND) {
    fautes.push('un bloc de l’accueil demande ' + pire + ' points de haut '
      + '(plafond ' + PLAFOND + ') — sur un téléphone courant il occupe la '
      + 'moitié de l’écran ou plus et repousse tout le reste hors de vue. '
      + 'C’est la signature de la boucle de mesure décrite en tête de fichier');
  } else {
    notes.push('la plus grande hauteur demandée est ' + pire + ' points (plafond '
      + PLAFOND + ')');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️  ET LA BOUCLE ELLE-MÊME NE DOIT PAS REVENIR.
  //
  // Le plafond ci-dessus attrape le SYMPTÔME, et seulement dans le décor de
  // cet essai : `monter` ne rejoue pas les passes de mise en page d'un vrai
  // téléphone, donc il ne verra jamais la carte enfler sous ses yeux. Il
  // faut donc aussi interdire le MÉCANISME.
  //
  // La règle : dans cet écran, aucune hauteur mesurée par `onLayout` ne doit
  // redevenir la hauteur passée à un enfant.
  // ═══════════════════════════════════════════════════════════════════════
  const { APP } = require('./harnais');
  const src = sansCommentaires(
    fs.readFileSync(path.join(APP, 'ecrans', 'Aujourdhui.js'), 'utf8'));

  // Les états alimentés par un `onLayout`…
  const parLayout = new Set();
  for (const m of src.matchAll(/onLayout\s*=\{[\s\S]{0,400}?\}\}/g)) {
    for (const s of m[0].matchAll(/\bset([A-Z]\w*)\s*\(/g)) {
      parLayout.add(s[1][0].toLowerCase() + s[1].slice(1));
    }
  }
  // …ne doivent pas servir à calculer une hauteur passée en `hauteur=`.
  for (const nom of parLayout) {
    const sert = new RegExp('hauteur\\s*=\\s*\\{[^}]*\\b' + nom + '\\b').test(src)
      || new RegExp('\\b\\w*[Hh]auteur\\w*\\s*=[^;\\n]*\\b' + nom + '\\b').test(src)
      || new RegExp('\\bhCarte\\s*=[^;\\n]*\\b' + nom + '\\b').test(src);
    if (sert) {
      fautes.push('la hauteur mesurée « ' + nom +' » redevient la hauteur '
        + 'donnée à un enfant : c’est la boucle qui faisait enfler la carte à '
        + 'chaque passe de mise en page. Un conteneur dont la hauteur découle '
        + 'de son contenu ne peut pas dimensionner ce contenu');
    }
  }
  if (!fautes.length) {
    notes.push(parLayout.size
      ? 'aucune des ' + parLayout.size + ' hauteurs mesurées ne redevient une hauteur imposée'
      : 'l’accueil ne mesure plus son propre conteneur pour se dimensionner');
  }

  return { notes, fautes };
};
