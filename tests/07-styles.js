/**
 * Les styles doivent être du React Native, pas du CSS.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE TEST EXISTE, ET POURQUOI LE BANC VISUEL NE SUFFIT PAS
 *
 * Le banc de rendu (harnais.js) traduit les styles React Native en CSS et
 * les montre dans un navigateur. C'est ce qui a permis de voir la moitié des
 * défauts de cette application — mais ça crée un angle mort exact :
 *
 *   un navigateur accepte du CSS que React Native REFUSE.
 *
 * `boxShadow`, `cursor`, `transition`, `float`, `whiteSpace`, `outline` :
 * tous s'afficheraient parfaitement sur la planche de contrôle, et feraient
 * lever une exception sur le téléphone — ou, pire, seraient silencieusement
 * ignorés en production sur une des deux plateformes.
 *
 * Ce test lit chaque `StyleSheet.create({...})` de l'application et refuse
 * toute propriété qui n'existe pas dans React Native. Il ne dépend d'aucun
 * rendu : c'est une lecture du code source.
 *
 * ⚠️  Il ne remplace pas un lancement réel dans Expo. Il attrape la faute la
 * plus facile à commettre quand on met en page en regardant un navigateur.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { APP, aLApp, sansCommentaires } = require('./harnais');

/** Les propriétés de style que React Native connaît (View, Text, Image). */
const CONNUES = new Set([
  // disposition
  'display', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'top', 'left', 'right', 'bottom', 'start', 'end', 'position', 'zIndex',
  'flex', 'flexBasis', 'flexDirection', 'flexGrow', 'flexShrink', 'flexWrap',
  'justifyContent', 'alignItems', 'alignSelf', 'alignContent',
  'gap', 'rowGap', 'columnGap', 'aspectRatio', 'direction', 'overflow',
  // marges et espacements
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'paddingHorizontal', 'paddingVertical', 'paddingStart', 'paddingEnd',
  // bordures
  'borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRightWidth', 'borderStartWidth', 'borderEndWidth',
  'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor',
  'borderRightColor', 'borderStartColor', 'borderEndColor',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderTopStartRadius', 'borderTopEndRadius',
  'borderBottomStartRadius', 'borderBottomEndRadius',
  'borderStyle', 'borderCurve',
  // fond et rendu
  'backgroundColor', 'opacity', 'elevation', 'transform', 'transformOrigin',
  'shadowColor', 'shadowOffset', 'shadowOpacity', 'shadowRadius',
  'backfaceVisibility', 'pointerEvents', 'boxShadow', 'filter', 'mixBlendMode',
  // texte
  'color', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontVariant',
  'letterSpacing', 'lineHeight', 'textAlign', 'textAlignVertical',
  'textDecorationLine', 'textDecorationStyle', 'textDecorationColor',
  'textShadowColor', 'textShadowOffset', 'textShadowRadius', 'textTransform',
  'includeFontPadding', 'writingDirection', 'userSelect', 'verticalAlign',
  // image
  'resizeMode', 'tintColor', 'overlayColor', 'objectFit'
]);

/**
 * Les pièges classiques : du CSS que le navigateur du banc affiche très bien
 * et que React Native ne connaît pas. On les nomme pour que le message
 * d'erreur dise quoi faire, pas seulement « inconnu ».
 */
const PIEGES = {
  cursor: 'inutile sur mobile — à retirer',
  transition: 'React Native anime avec Animated, pas avec des transitions CSS',
  animation: 'React Native anime avec Animated',
  float: 'utiliser flexDirection',
  clear: 'utiliser flexDirection',
  whiteSpace: 'le Text de React Native passe à la ligne tout seul',
  outline: 'utiliser borderWidth / borderColor',
  outlineColor: 'utiliser borderColor',
  visibility: 'utiliser un rendu conditionnel, ou opacity',
  boxSizing: 'React Native est toujours en border-box',
  wordBreak: 'sans équivalent — laisser Text gérer',
  textOverflow: 'utiliser numberOfLines sur le Text',
  content: 'sans équivalent',
  listStyle: 'sans équivalent',
  background: 'utiliser backgroundColor',
  border: 'utiliser borderWidth, borderColor et borderStyle séparément',
  font: 'utiliser fontFamily, fontSize et fontWeight séparément',
  flexFlow: 'utiliser flexDirection et flexWrap séparément',
  placeItems: 'utiliser alignItems et justifyContent'
};

/** Tous les fichiers .js de l'application. */
function fichiers(racine) {
  const out = [];
  (function marche(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) marche(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  })(racine);
  return out;
}

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const fautes = [];
  let blocs = 0, proprietes = 0;

  for (const f of fichiers(APP)) {
    const code = fs.readFileSync(f, 'utf8');
    const court = path.relative(APP, f);

    // On isole chaque StyleSheet.create({...}) en comptant les accolades :
    // une expression régulière seule s'arrête à la première accolade fermante
    // et ne verrait qu'un style sur dix.
    let i = code.indexOf('StyleSheet.create(');
    while (i >= 0) {
      let j = code.indexOf('{', i);
      if (j < 0) break;
      let profondeur = 0, k = j;
      for (; k < code.length; k++) {
        if (code[k] === '{') profondeur++;
        else if (code[k] === '}') { profondeur--; if (profondeur === 0) break; }
      }
      // ⚠️  Les commentaires sont retirés AVANT l'analyse. Ce projet commente
      // ses feuilles de style en français, et « `gap` manquait : les faits se
      // touchaient » offre au motif un « manquait : » impeccable. Le test
      // dénonçait quatre mots de prose comme des propriétés inventées.
      const bloc = sansCommentaires(code.slice(j, k + 1));
      blocs++;

      // Les clés de style sont à deux niveaux : { nomDuStyle: { propriété: … } }.
      // On ne regarde que celles suivies d'une valeur qui n'est pas un objet —
      // ce sont les propriétés ; les autres sont des noms de styles.
      //  ⚠️  Le premier caractère non blanc de la valeur est CAPTURÉ, il n'est
      //  pas testé par anticipation. Écrit `\s*(?!\{)`, le moteur revient en
      //  arrière sur les espaces pour satisfaire la négation : « fond: { » y
      //  passait pour une propriété, et le test signalait les quarante noms de
      //  styles de l'app comme autant de fautes. Un test qui crie partout ne
      //  sert à rien — on ne le lit plus.
      const re = /(^|[{,\s])([A-Za-z][A-Za-z0-9]*)\s*:\s*([^\s])/g;
      let m;
      while ((m = re.exec(bloc)) !== null) {
        if (m[3] === '{') continue;   // c'est un nom de style, pas une propriété
        const nom = m[2];
        proprietes++;
        if (CONNUES.has(nom)) continue;
        // width/height dans un shadowOffset, etc. : déjà couverts.
        if (['width', 'height', 'x', 'y'].includes(nom)) continue;
        const piege = PIEGES[nom];
        fautes.push(court + ' : « ' + nom + ' » n’existe pas dans React Native'
          + (piege ? ' — ' + piege : ''));
      }

      i = code.indexOf('StyleSheet.create(', k);
    }
  }

  return {
    notes: [blocs + ' feuilles de style, ' + proprietes + ' propriétés vérifiées'],
    fautes
  };
};
