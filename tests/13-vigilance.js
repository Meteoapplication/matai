/**
 * Un niveau de vigilance qu'on ne connaît pas n'est pas un niveau vert.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * `BandeauVigilance.js` porte déjà la règle du gris : quand la vigilance
 * n'a pas pu être récupérée, l'écran affiche GRIS et jamais VERT, parce
 * que le vert veut dire « Météo-France a regardé et il n'y a rien » et non
 * « je ne sais pas ».
 *
 * Ce fichier garde la même règle DE L'AUTRE CÔTÉ : celui de la décision.
 *
 * ⚠️  LE DÉFAUT QUI A MOTIVÉ CE TEST.
 *
 *     const e = (vigilance && vigilance.etat) || 'inconnu';
 *     return (GRAVITE[e] || 0) >= (GRAVITE[seuil] || 3);
 *
 * Les deux rendus repliaient bien un état inconnu sur « inconnu ». La
 * fonction qui décide si le bandeau doit s'imposer, elle, ne le faisait
 * pas : `GRAVITE['écarlate']` vaut `undefined`, `undefined || 0` vaut 0,
 * et 0 c'est VERT. Un intitulé que Météo-France change un jour — une
 * graphie, un accent, un mot nouveau — et le bandeau cessait de s'imposer
 * exactement le jour où il se passait quelque chose d'inhabituel.
 *
 * L'écran, lui, disait « VIGILANCE ? » en gris. L'affichage disait la
 * vérité pendant que la décision disait le contraire : rien ne se voyait.
 *
 * ⚠️  ET LE SEUIL AVAIT LA MÊME FORME.
 *
 * `graveOuPire(v, 'vert')` demande un seuil de gravité 0. `0 || 3` en fait
 * 3, c'est-à-dire « orange ». Le seuil le plus bas devenait celui du
 * milieu, et un `||` sur une valeur dont zéro est légitime est un défaut à
 * lui tout seul.
 * ═══════════════════════════════════════════════════════════════════════
 */

const { charger, aLApp } = require('./harnais');

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const B = charger('composants/BandeauVigilance');
  const fautes = [];
  const notes = [];

  // ── tout état inconnu se replie sur « inconnu », jamais sur « vert »
  const ETRANGERS = [
    'écarlate', 'ECARLATE', 'Vert', 'VERT', 'orange foncé', '', ' ',
    null, undefined, 0, 42, 'toString', 'constructor', '__proto__'
  ];
  for (const e of ETRANGERS) {
    const r = B.niveauConnu(e);
    if (r !== 'inconnu') {
      fautes.push('« ' + String(e) + ' » a été accepté comme niveau « ' + r + ' »');
    }
  }
  notes.push(ETRANGERS.length + ' états étrangers repliés sur « inconnu »');

  // ⚠️  « toString », « constructor » et « __proto__ » ne sont pas des
  // curiosités : ce sont des clés que TOUT objet JavaScript possède par
  // héritage. Un `NIVEAUX[etat] ? …` sur un objet ordinaire les accepte,
  // et l'application irait alors lire `NIVEAUX['toString'].couleur` — une
  // fonction, donc `undefined`, donc un plantage de rendu du bandeau qui
  // doit être en haut de CHAQUE page.

  // ── les niveaux connus le restent
  for (const e of Object.keys(B.NIVEAUX)) {
    if (B.niveauConnu(e) !== e) fautes.push('le niveau connu « ' + e + ' » a été rejeté');
  }
  notes.push(Object.keys(B.NIVEAUX).length + ' niveaux connus préservés');

  // ── un inconnu ne doit jamais être moins grave qu'un vert
  const CAS = [
    // vigilance,                 seuil,    doit s'imposer ?
    [{ etat: 'rouge' },           'orange', true],
    [{ etat: 'orange' },          'orange', true],
    [{ etat: 'violet' },          'orange', true],
    [{ etat: 'gris' },            'orange', true],
    [{ etat: 'jaune' },           'orange', false],
    [{ etat: 'vert' },            'orange', false],
    [{ etat: 'inconnu' },         'orange', false],

    // ⚠️  le cœur du test : un état que nous ne connaissons pas doit se
    // comporter comme « inconnu », donc être PLUS grave que « vert ».
    [{ etat: 'écarlate' },        'vert',   true],
    [{ etat: 'vert' },            'vert',   true],
    [null,                        'vert',   true],
    [undefined,                   'vert',   true],
    [{},                          'vert',   true],

    // et au seuil « jaune », un inconnu ne s'impose pas — il n'est pas non
    // plus une alerte : on ne fabrique pas d'alarme à partir d'un silence.
    [{ etat: 'écarlate' },        'jaune',  false],
    [{ etat: 'inconnu' },         'jaune',  false],
    [{ etat: 'jaune' },           'jaune',  true],

    // un seuil lui-même inconnu retombe sur « orange », pas sur « vert »
    [{ etat: 'jaune' },           'mauve',  false],
    [{ etat: 'rouge' },           'mauve',  true]
  ];

  for (const [v, seuil, attendu] of CAS) {
    const r = B.graveOuPire(v, seuil);
    if (r !== attendu) {
      fautes.push('graveOuPire(' + JSON.stringify(v) + ', « ' + seuil + ' ») vaut '
        + r + ' au lieu de ' + attendu);
    }
  }
  notes.push(CAS.length + ' comparaisons de gravité vérifiées');

  // ── le seuil par défaut reste « orange »
  if (B.graveOuPire({ etat: 'jaune' }) !== false
      || B.graveOuPire({ etat: 'orange' }) !== true) {
    fautes.push('le seuil par défaut n’est plus « orange »');
  }

  // ── un état inconnu ne doit jamais faire planter le rendu du bandeau
  const { React, TR } = require('./harnais');
  for (const e of ['écarlate', 'toString', '__proto__', null]) {
    try {
      const a = TR.create(React.createElement(B.default,
        { vigilance: { etat: e }, nomIle: 'Bora Bora' }));
      const t = JSON.stringify(a.toJSON());
      if (!/VIGILANCE \?/.test(t)) {
        fautes.push('l’état « ' + String(e) + ' » ne s’affiche pas « VIGILANCE ? »');
      }
      if (/vert|Pas de vigilance particulière/.test(t)) {
        fautes.push('l’état « ' + String(e) + ' » s’affiche comme un vert');
      }
      a.unmount();
    } catch (err) {
      fautes.push('l’état « ' + String(e) + ' » fait planter le bandeau : ' + err.message);
    }
  }
  notes.push('4 états étrangers rendus sans plantage, tous en « VIGILANCE ? »');

  // ═══════════════════════════════════════════════════════════════════════
  // ET LA MÊME RÈGLE DANS L'AUTRE COMPOSANT QUI L'AFFICHE.
  //
  // `Briques.js` porte un second bloc de vigilance, avec sa propre table et
  // sa propre normalisation. Il avait la faute du prototype ET une autre,
  // pire : `connue = v.etat !== 'inconnu'` valait VRAI pour un état
  // inconnu-mais-pas-nommé-« inconnu ». Le bloc affichait alors la note
  // « Météo-France · zone · heure » — une vigilance présentée comme
  // RÉCUPÉRÉE — sous un titre qui disait « non récupérée ».
  //
  // Deux composants, une seule règle : c'est ce qu'on vérifie ici.
  // ═══════════════════════════════════════════════════════════════════════
  const Br = charger('composants/Briques');
  for (const e of ['écarlate', 'toString', '__proto__']) {
    try {
      // ⚠️  On donne une zone et une heure, comme un vrai paquet en porte :
      // sans elles, la note « récupérée » se réduit au mot « Météo-France »
      // et devient indiscernable. Le premier jet de ce test cherchait
      // « Météo-France · » et laissait donc passer « écarlate », qui est
      // pourtant le cas ordinaire — celui d'un intitulé qui change.
      const a = TR.create(React.createElement(Br.Vigilance, {
        vigilance: { etat: e, zone: 'Îles Sous-le-Vent', maj: '2026-08-28T06:00' }
      }));
      const t = JSON.stringify(a.toJSON());
      if (!/non récupérée/.test(t)) {
        fautes.push('Briques : l’état « ' + String(e) + ' » n’est pas dit « non récupérée »');
      }
      // La note honnête, celle du cas « on ne sait pas ».
      if (!/Consultez meteo\.pf/.test(t)) {
        fautes.push('Briques : l’état « ' + String(e) + ' » est présenté comme récupéré — '
          + 'la note renvoie à la zone et à l’heure au lieu de dire qu’on ne sait pas');
      }
      if (/Sous-le-Vent/.test(t)) {
        fautes.push('Briques : l’état « ' + String(e) + ' » affiche une zone '
          + 'alors que la vigilance n’a pas été comprise');
      }
      if (/undefined/.test(t)) {
        fautes.push('Briques : l’état « ' + String(e) + ' » a produit un « undefined » à l’écran');
      }
      a.unmount();
    } catch (err) {
      fautes.push('Briques : l’état « ' + String(e) + ' » fait planter le bloc : ' + err.message);
    }
  }
  notes.push('3 états étrangers vérifiés aussi sur le bloc de Briques.js');

  return { notes, fautes };
};
