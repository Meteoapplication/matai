/**
 * On casse l'app exprès.
 *
 * Un paquet parfait ne prouve rien. Ce qui compte, c'est ce que l'écran
 * raconte quand la donnée manque — et il y a deux fautes possibles, dont la
 * seconde est la grave :
 *
 *   1. planter — visible, embêtant, réparable ;
 *   2. INVENTER une valeur rassurante — invisible, et c'est celle qui met
 *      quelqu'un à l'eau. « UV 0 » à midi, « vent 0 nœud » sur un champ
 *      absent, « houle 0,0 m » quand l'API marine n'a rien renvoyé.
 *
 * Douze paquets abîmés × quatre écrans. Aucune exception, aucun chiffre sorti
 * de nulle part. Un tiret, « inconnue », un silence : tout va. Un zéro, non.
 *
 * Prise au premier passage : « Vent — nœuds, de null ». La vitesse se
 * dégradait proprement, la direction était concaténée telle quelle. La garde
 * existait pourtant dans `rose()` — elle était jetée à l'appel. On ne teste
 * donc pas l'entrée d'un outil, on teste ce qu'il a répondu.
 */

const fs = require('fs');
const path = require('path');
const { charger, monter, texte, aLApp } = require('./harnais');

/** Ce qui ne doit JAMAIS atteindre l'écran quand la donnée est absente. */
const INTERDITS = [
  { quoi: 'indice UV inventé',    re: /\bUV\s*0\b|indice\s*UV\s*:?\s*0\b/i },
  { quoi: 'vent nul inventé',     re: /\b0\s*(nds|nœuds|noeuds)\b/i },
  { quoi: 'houle nulle inventée', re: /\b0[,.]0\s*m\b/ },
  { quoi: 'NaN à l’écran',        re: /NaN/ },
  { quoi: 'undefined à l’écran',  re: /undefined/ },
  { quoi: 'null à l’écran',       re: /\bnull\b/ }
];

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const source = path.resolve(__dirname, '..', 'paquets', 'bora-bora.json');
  if (!fs.existsSync(source)) {
    return { saute: 'aucun paquet sous la main (lancer « npm run demo » d’abord)' };
  }

  const Sortie = charger('ecrans/Sortie').default;
  // ⚠️  C'était `ecrans/Carte` — l'écran a été supprimé le 28 août : son
  // contenu (le trait de côte, les récifs, « de quel côté aller ») avait été
  // déplacé dans CIEL, et le fichier restait sur le disque sans que rien ne
  // l'importe. C'est CIEL qui porte la carte maintenant, donc c'est CIEL
  // qu'on éprouve ici : sinon on continue de vérifier un écran mort pendant
  // que le vivant n'est plus regardé.
  const Ciel = charger('ecrans/Ciel').default;
  const Pro = charger('ecrans/Pro').default;
  const Aujourdhui = charger('ecrans/Aujourdhui').default;
  const seuils = charger('seuils');
  const donnees = charger('donnees');

  const SAIN = JSON.parse(fs.readFileSync(source, 'utf8'));
  SAIN.ile = SAIN.ile || 'bora-bora';
  const clone = () => JSON.parse(JSON.stringify(SAIN));

  const CAS = [
    ['paquet sans aucun spot', () => { const p = clone(); p.spots = []; return p; }],
    ['spots absents du tout', () => { const p = clone(); delete p.spots; return p; }],
    ['spot sans aucune heure', () => { const p = clone(); for (const s of p.spots) s.heures = []; return p; }],
    ['heures absentes du tout', () => { const p = clone(); for (const s of p.spots) delete s.heures; return p; }],

    ['toutes les heures dans le passé', () => {
      const p = clone();
      for (const s of p.spots) {
        s.heures = (s.heures || []).map((h, i) => ({
          ...h, t: '2020-01-0' + ((i % 8) + 1) + 'T0' + (i % 10) + ':00'
        }));
      }
      return p;
    }],

    ['champs bonus tous nuls (repli vent seul)', () => {
      const p = clone();
      for (const s of p.spots) for (const h of s.heures || []) {
        h.uv = null; h.uvClair = null; h.temp = null; h.ciel = null; h.pluie = null;
      }
      return p;
    }],

    ['API marine muette : houle nulle partout', () => {
      const p = clone();
      for (const s of p.spots) {
        s.erreurMarine = 'HTTP 503';
        for (const h of s.heures || []) { h.houle = null; h.periode = null; h.houleDir = null; }
      }
      return p;
    }],

    ['vent nul (le champ indispensable manque)', () => {
      const p = clone();
      for (const s of p.spots) for (const h of s.heures || []) {
        h.vent = null; h.rafale = null; h.dir = null;
      }
      return p;
    }],

    ['NaN et chaînes là où on attend des nombres', () => {
      const p = clone();
      for (const s of p.spots) for (const h of s.heures || []) {
        h.vent = NaN; h.houle = 'beaucoup'; h.uv = undefined; h.temp = 'chaud';
      }
      return p;
    }],

    ['île inconnue, sans contour ni archipel', () => {
      const p = clone();
      p.ile = 'ile-de-nulle-part'; p.id = 'ile-de-nulle-part'; p.nom = 'Île sans nom';
      delete p.archipel; delete p.lat; delete p.lon;
      return p;
    }],

    ['vieux format en cache : ni ciel, ni vigilance, ni type de spot', () => {
      const p = clone();
      delete p.cielRegional; delete p.vigilance; delete p.genere; delete p.expire;
      for (const s of p.spots) { delete s.type; delete s.lat; delete s.lon; }
      return p;
    }],

    ['paquet quasi vide', () => ({ ile: 'bora-bora', nom: 'Bora Bora', spots: [] })]
  ];

  const commun = { onChangerIle() {}, iles: [], position: null, animation: null };
  const fautes = [];
  let montages = 0;

  for (const [nom, faire] of CAS) {
    let p;
    try { p = faire(); } catch (e) { fautes.push(nom + ' : le cas lui-même a échoué'); continue; }

    const sp = (p.spots && p.spots[0]) || null;
    let hs = [], an = { cat: 'inconnu' };
    try {
      hs = donnees.depuisMaintenant((sp && sp.heures) || []);
      an = seuils.analyser(hs, (sp && sp.type) || 'lagon');
    } catch (e) { /* on veut monter les écrans quand même */ }

    const ecrans = [
      ['Aujourd’hui', Aujourdhui, { ...commun, ile: p, fraicheurTexte: 'il y a 20 min',
        surPlace: true, plein: false, onPlein() {}, onDetail() {} }],
      ['Sortie', Sortie, { ...commun, ile: p, spot: sp, heures: hs, analyse: an,
        fraicheurTexte: 'il y a 20 min', horsLigne: false, alertesActives: false,
        onBasculerAlertes() {}, enCours: false, onRafraichir() {}, onVoirCiel() {},
        onChoisirSpot() {} }],
      ['Ciel', Ciel, { ...commun, ile: p, animation: null, projection: null,
        fraicheurTexte: 'il y a 20 min' }],
      ['Pro', Pro, { ...commun, ile: p, ageMin: 22, fraicheurTexte: 'il y a 20 min' }]
    ];

    for (const [ecran, Comp, props] of ecrans) {
      montages++;
      let txt;
      try {
        txt = texte(monter(Comp, props)).join(' ');
      } catch (e) {
        fautes.push('PLANTAGE ' + ecran + ' · ' + nom + ' — ' + e.message);
        continue;
      }
      for (const i of INTERDITS) {
        const m = txt.match(i.re);
        if (m) fautes.push('VALEUR INVENTÉE ' + ecran + ' · ' + nom + ' — ' + i.quoi + ' : « ' + m[0] + ' »');
      }
    }
  }

  return {
    notes: [montages + ' montages (' + CAS.length + ' paquets abîmés × 4 écrans)'],
    fautes
  };
};
