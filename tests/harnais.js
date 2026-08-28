/**
 * Mata'i — le banc d'essai.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 *
 * L'application tourne sur un téléphone, et on n'en a pas toujours un sous
 * la main. Ce module charge les modules de l'app — y compris les écrans,
 * avec leur JSX et leurs imports React Native — dans un Node ordinaire, et
 * sait les rendre en HTML pour qu'on puisse les REGARDER.
 *
 * Ce n'est pas le rendu du téléphone. C'est assez proche pour montrer une
 * mise en page cassée, un texte tronqué, deux étiquettes superposées ou un
 * « null » qui arrive à l'écran — c'est-à-dire la classe de défauts qu'on ne
 * voit jamais en relisant du JSX, et qui a fourni la moitié des corrections
 * de ce projet.
 *
 * ⚠️  Il rend avec React 18 (react-test-renderer), tandis que l'app embarque
 * React 19 : `react-test-renderer` n'existe plus au-delà de 18. Aucune des
 * fonctions concernées (concurrence, transitions) n'est utilisée ici, donc
 * l'arbre produit est le même — mais c'est une différence réelle, et il faut
 * la savoir plutôt que la découvrir.
 *
 * ⚠️  Les modules natifs sont remplacés par des doublures (voir FAUX). Une
 * doublure fausse fabrique de faux défauts : deux bogues de CE fichier ont
 * failli me faire « corriger » des défauts qui n'existaient pas dans l'app.
 * Les deux sont commentés sur place. Quand un défaut n'apparaît qu'ici,
 * SOUPÇONNER CE FICHIER D'ABORD.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const React = require('react');
const TR = require('react-test-renderer');

/* ───────────────────── où se trouve l'application ───────────────────── */

/**
 * Le dépôt du backend et celui de l'app sont séparés. On cherche les sources
 * de l'app à côté, et on accepte qu'elles soient absentes : les tests de
 * logique pure et ceux du backend doivent tourner quand même, notamment dans
 * l'intégration continue où seul le backend est déployé.
 */
function racineApp() {
  if (process.env.MATAI_APP) return process.env.MATAI_APP;
  const candidats = [
    path.resolve(__dirname, '..', '..', 'matai-app', 'src'),
    path.resolve(__dirname, '..', '..', 'matai-app', 'matai-app', 'src'),
    path.resolve(__dirname, '..', 'matai-app', 'src')
  ];
  for (const c of candidats) if (fs.existsSync(c)) return c;
  return null;
}

const APP = racineApp();
const aLApp = () => APP !== null;

/* ────────────────────── les doublures natives ────────────────────── */

const el = (n) => { const f = (p) => React.createElement(n, p, p && p.children); f.displayName = n; return f; };
const svg = (n) => { const f = (p) => React.createElement('svg:' + n, p, p && p.children); f.displayName = n; return f; };

const FAUX = {
  'react-native': {
    View: el('rn-view'), Text: el('rn-text'), ScrollView: el('rn-scroll'),
    Pressable: el('rn-press'), TouchableOpacity: el('rn-press'),
    StyleSheet: { create: (o) => o, absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } }, Switch: el('rn-switch'), RefreshControl: el('rn-rc'),
    Share: { share: async () => ({}) }, Platform: { OS: 'ios', select: (o) => o.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) }, Image: el('rn-image'),
    ActivityIndicator: el('rn-spin'), Linking: { openURL: () => {} }
  },
  'react-native-webview': { WebView: el('rn-webview'), default: el('rn-webview'), __esModule: true },
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }
  },
  'react-native-svg': (() => {
    const s = svg('svg');
    return Object.assign(s, {
      __esModule: true, default: s,
      Rect: svg('rect'), Path: svg('path'), Circle: svg('circle'), G: svg('g'),
      Line: svg('line'), Text: svg('text'), Ellipse: svg('ellipse'), Polygon: svg('polygon'),
      Defs: svg('defs'), LinearGradient: svg('linearGradient'), Stop: svg('stop')
    });
  })()
};

/* ─────────────────────────── le chargeur ─────────────────────────── */

const cache = {};

/**
 * Charge un module de l'app. Le chemin peut être relatif à src/
 * (`'activites'`, `'ecrans/Sortie'`) ou absolu.
 */
function charger(quoi) {
  let f = quoi;
  if (!path.isAbsolute(f)) {
    if (!APP) throw new Error('sources de l’application introuvables (voir MATAI_APP)');
    f = path.resolve(APP, f);
  }
  if (!/\.[a-z]+$/.test(f) && fs.existsSync(f + '.js')) f += '.js';
  if (cache[f]) return cache[f].exports;

  const code = babel.transformFileSync(f, {
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    babelrc: false, configFile: false
  }).code;

  const mod = { exports: {} };
  cache[f] = mod;

  const req = (s) => {
    if (FAUX[s]) return FAUX[s];
    if (s === 'react') return React;
    // Tout autre paquet externe devient un objet qui accepte n'importe quel
    // accès sans rien faire. C'est volontairement permissif : le banc sert à
    // regarder la mise en page, pas à valider une dépendance tierce.
    if (!s.startsWith('.')) {
      const muet = new Proxy(function () {}, {
        get: (t, k) => (k === '__esModule' ? true : muet),
        apply: () => muet
      });
      return muet;
    }
    let p = path.resolve(path.dirname(f), s);
    if (/\.json$/.test(p) && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    if (fs.existsSync(p + '.json')) return JSON.parse(fs.readFileSync(p + '.json', 'utf8'));
    if (fs.existsSync(p + '.js')) p += '.js';
    return charger(p);
  };

  new Function('require', 'module', 'exports', 'React', code)(req, mod, mod.exports, React);
  return mod.exports;
}

/* ─────────────────────── rendu et inspection ─────────────────────── */

/** Monte un composant et renvoie l'arbre JSON de react-test-renderer. */
function monter(Composant, props) {
  let arbre = null;
  TR.act(() => { arbre = TR.create(React.createElement(Composant, props)); });
  return arbre.toJSON();
}

/** Tout le texte visible d'un arbre, dans l'ordre de lecture. */
function texte(n, out) {
  out = out || [];
  if (n === null || n === undefined || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { for (const x of n) texte(x, out); return out; }
  if (n.children) texte(n.children, out);
  return out;
}


/**
 * Déclenche les `onLayout` d'un arbre monté, pour les composants qui se
 * MESURENT avant de se dessiner.
 *
 * `react-test-renderer` ne fait aucune mise en page : les `onLayout` ne
 * partent jamais tout seuls. Un composant qui attend sa taille reste donc
 * dans son état de repli, et le rendu de contrôle montre ce repli au lieu de
 * l'écran réel — c'est ce qui est arrivé au décor du ciel, dessiné dans un
 * carré étiré au lieu du cadre du téléphone.
 *
 * `tailles` associe un testID à { width, height }.
 */
function mesurer(arbre, tailles) {
  TR.act(() => {
    for (const [id, taille] of Object.entries(tailles)) {
      for (const n of arbre.root.findAll(
        (x) => x.props && x.props.testID === id && typeof x.props.onLayout === 'function',
        { deep: true }
      )) {
        n.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...taille } } });
      }
    }
  });
}


/**
 * Retire les commentaires d'un code source, en gardant la longueur du texte :
 * chaque caractère commenté devient une espace plutôt que de disparaître, ce
 * qui évite de recoller deux morceaux de code qui ne se touchaient pas.
 *
 * ⚠️  Deux tests s'en servent, et les deux en ont eu besoin pour la même
 * raison : ce projet commente abondamment, en français, EN CITANT le code
 * fautif. « `gap` manquait : … » offre un « manquait : » impeccable à qui
 * cherche des propriétés de style ; le commentaire qui explique pourquoi on
 * n'importe plus l'index d'un paquet de polices contient, forcément, cet
 * import. Un analyseur qui lit les commentaires se dénonce lui-même.
 */
function sansCommentaires(t) {
  let out = '';
  let etat = 'code';
  for (let i = 0; i < t.length; i++) {
    const c = t[i], d = t[i + 1];
    if (etat === 'code') {
      if (c === '/' && d === '/') { etat = 'ligne'; out += '  '; i++; continue; }
      if (c === '/' && d === '*') { etat = 'bloc'; out += '  '; i++; continue; }
      out += c;
    } else if (etat === 'ligne') {
      if (c === '\n') { etat = 'code'; out += c; } else out += ' ';
    } else {
      if (c === '*' && d === '/') { etat = 'code'; out += '  '; i++; }
      else out += (c === '\n' ? c : ' ');
    }
  }
  return out;
}

/* ─────────────────────── traduction des styles ─────────────────────── */

const PX = new Set(['width', 'height', 'margin', 'marginTop', 'marginBottom', 'marginLeft',
  'marginRight', 'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'paddingHorizontal', 'paddingVertical', 'borderWidth', 'borderTopWidth', 'borderBottomWidth',
  'borderLeftWidth', 'borderRightWidth', 'borderRadius', 'fontSize', 'lineHeight', 'gap',
  'top', 'left', 'right', 'bottom', 'minHeight', 'maxHeight', 'minWidth', 'letterSpacing']);

const POLICES = {
  Spectral_600SemiBold: "Georgia, 'Times New Roman', serif",
  Spectral_400Regular_Italic: 'Georgia, serif',
  LibreFranklin_400Regular: "'Helvetica Neue', Arial, sans-serif",
  LibreFranklin_600SemiBold: "'Helvetica Neue', Arial, sans-serif"
};

function css(style) {
  const plat = [];
  (function ap(x) { if (!x) return; if (Array.isArray(x)) return x.forEach(ap); plat.push(x); })(style);
  const o = Object.assign({}, ...plat);
  const out = [];

  // ⚠️  DOUBLURE N° 1, corrigée. Deux écarts entre RN et CSS sur les
  // bordures, et les deux mordent :
  //   — RN dessine dès qu'une LARGEUR est posée, CSS exige aussi un style ;
  //   — CSS donne aux côtés sans largeur la valeur « medium », soit 3 px,
  //     là où RN met zéro.
  // Poser un style sans remettre les largeurs à zéro encadrait donc tout
  // d'un rectangle qui n'existe nulle part dans l'application.
  if (Object.keys(o).some((k) => /^border.*Width$/.test(k) || k === 'borderStyle')) {
    out.push('border-width:0', 'border-style:' + (o.borderStyle || 'solid'), 'border-color:transparent');
  }

  // RN écrit l'ombre du texte en trois propriétés, CSS en une seule. Sans
  // cette traduction, le banc rendait « text-shadow-color: … », que le
  // navigateur ignore — et l'écran d'accueil paraissait illisible ici alors
  // qu'il ne l'est pas sur le téléphone.
  if (o.textShadowColor) {
    const off = o.textShadowOffset || { width: 0, height: 0 };
    out.push('text-shadow:' + (off.width || 0) + 'px ' + (off.height || 0) + 'px '
      + (o.textShadowRadius || 0) + 'px ' + o.textShadowColor);
  }

  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    if (/^textShadow/.test(k)) continue;
    const prop = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    let val = v;
    if (k === 'paddingHorizontal') { out.push('padding-left:' + v + 'px', 'padding-right:' + v + 'px'); continue; }
    if (k === 'paddingVertical') { out.push('padding-top:' + v + 'px', 'padding-bottom:' + v + 'px'); continue; }
    if (k === 'marginHorizontal') { out.push('margin-left:' + v + 'px', 'margin-right:' + v + 'px'); continue; }
    if (k === 'marginVertical') { out.push('margin-top:' + v + 'px', 'margin-bottom:' + v + 'px'); continue; }
    if (k === 'fontFamily') {
      out.push('font-family:' + (POLICES[v] || v));
      if (/SemiBold|fort|titre/i.test(v)) out.push('font-weight:600');
      if (/Italic/i.test(v)) out.push('font-style:italic');
      continue;
    }
    if (PX.has(k) && typeof v === 'number') val = v + 'px';
    out.push(prop + ':' + val);
  }
  return out.join(';');
}

function html(n) {
  if (n === null || n === undefined || n === false) return '';
  if (typeof n === 'string' || typeof n === 'number') {
    return String(n).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
  if (Array.isArray(n)) return n.map(html).join('');

  const { type, props } = n;
  const enfants = n.children;
  let st = css(props && props.style);
  if (type === 'rn-scroll' && props && props.contentContainerStyle) {
    st += ';' + css(props.contentContainerStyle);
  }

  if (type && type.startsWith('svg:')) {
    const nom = type.slice(4);
    const attrs = Object.entries(props || {})
      .filter(([k]) => !['children', 'style', 'key'].includes(k))
      .map(([k, v]) => {
        // ⚠️  SVG veut « stop-color », React Native Svg écrit « stopColor ».
        // Sans cette ligne le dégradé du ciel n'avait aucune couleur et
        // l'écran d'accueil sortait NOIR — un défaut du banc, pas de l'app.
        const a = {
          strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap',
          strokeLinejoin: 'stroke-linejoin', fontSize: 'font-size',
          textAnchor: 'text-anchor', strokeDasharray: 'stroke-dasharray',
          stopColor: 'stop-color', stopOpacity: 'stop-opacity',
          fillOpacity: 'fill-opacity', strokeOpacity: 'stroke-opacity'
        }[k] || k;
        return a + '="' + String(v).replace(/"/g, '&quot;') + '"';
      }).join(' ');
    const ouvre = nom === 'svg'
      ? '<svg xmlns="http://www.w3.org/2000/svg" ' + attrs + (st ? ' style="' + st + '"' : '') + '>'
      : '<' + nom + (attrs ? ' ' + attrs : '') + '>';
    return ouvre + html(enfants) + '</' + nom + '>';
  }

  // ⚠️  DOUBLURE N° 2, corrigée. Un ScrollView `horizontal` dispose ses
  // enfants en LIGNE. L'oublier faisait apparaître la bande de spots en
  // colonne, et j'ai failli « corriger » un défaut qui n'existait que là.
  const horiz = !!(props && props.horizontal);
  const base = {
    'rn-view': 'display:flex;flex-direction:column;position:relative',
    'rn-scroll': 'display:flex;flex-direction:' + (horiz ? 'row' : 'column') + ';overflow:hidden',
    'rn-press': 'display:flex;flex-direction:column;position:relative;cursor:pointer',
    'rn-text': 'display:block;white-space:pre-wrap',
    'rn-webview': 'display:block;background:#CFE0E8;border:1px dashed #AEC5CD',
    'rn-switch': 'width:44px;height:26px;background:#C9C0AC;border-radius:13px',
    'rn-spin': 'width:24px;height:24px;border-radius:12px;border:2px solid #4A6270'
  }[type] || 'display:block';

  const balise = type === 'rn-text' ? 'span' : 'div';
  return '<' + balise + ' style="' + base + ';' + st + '">' + html(enfants) + '</' + balise + '>';
}

/** Une page de contrôle : plusieurs écrans côte à côte, à la taille d'un téléphone. */
function planche(blocs, fichier) {
  const page = '<html><head><meta charset="utf-8"><style>'
    + 'body{margin:0;background:#8a9aa2;font-family:sans-serif;display:flex;flex-wrap:wrap;'
    + 'align-items:flex-start;gap:26px;padding:24px}'
    + '.tel{width:390px;background:#F2EEE2;box-shadow:0 6px 24px rgba(0,0,0,.35)}'
    + '.lg{color:#fff;font:600 13px sans-serif;margin:0 0 6px 2px}'
    + '</style></head><body>'
    + blocs.map((b) => '<div><p class="lg">' + b.nom + '</p><div class="tel">' + b.html + '</div></div>').join('')
    + '</body></html>';
  fs.writeFileSync(fichier, page);
  return fichier;
}

module.exports = { charger, monter, mesurer, texte, html, planche, sansCommentaires,
                   React, TR, APP, aLApp };
