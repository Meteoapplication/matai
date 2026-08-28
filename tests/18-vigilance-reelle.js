/**
 * La vraie réponse de Météo-France, gardée comme témoin.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * `tests/donnees/vigilance-polynesie.json` est la PREMIÈRE vraie réponse
 * du portail, obtenue le 28 août 2026 à 00 h 55 UTC. Jusque-là, tout ce
 * fichier était écrit d'après une documentation, et éprouvé sur des objets
 * fabriqués à sa ressemblance — c'est-à-dire à la ressemblance de ce qu'on
 * avait COMPRIS de la documentation.
 *
 * Elle a démenti deux choses du premier coup :
 *
 *   1. le flux ne porte pas le phénomène 11 mais le 9, absent de notre
 *      table — l'écran aurait écrit « phénomène 9 orange » sur sa ligne la
 *      plus importante ;
 *   2. le chemin est `polynesie`, sans accent, alors que le portail
 *      l'affiche accentué dans son sommaire.
 *
 * Aucune des deux n'était trouvable en relisant du code. C'est pour ça
 * qu'une vraie réponse, même une seule, vaut tout un banc d'essai
 * fabriqué : elle est la seule chose qui ne partage pas nos hypothèses.
 *
 * ⚠️  CE FICHIER EST UNE PHOTO, PAS UNE VÉRITÉ PERMANENTE.
 *
 * Il décrit un instant : Rapa en orange, tout le reste en vert. Il sert à
 * vérifier qu'on sait LIRE cette forme, pas à figer un état du ciel.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

/** Les neuf îles, et si leur zone est connue nommément. */
const ILES = [
  ['tahiti', true], ['moorea', true], ['bora-bora', true], ['raiatea', true],
  ['nuku-hiva', true], ['gambier', true],
  ['rangiroa', false], ['fakarava', false], ['tubuai', false]
];

module.exports = async function () {
  const fixture = path.join(__dirname, 'donnees', 'vigilance-polynesie.json');
  if (!fs.existsSync(fixture)) {
    return { saute: 'réponse de référence absente' };
  }

  const V = await import(
    'file://' + path.resolve(__dirname, '..', 'vigilance.mjs')
  );

  const brut = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const fautes = [];
  const notes = [];

  // ── la forme : `timelaps` est à la RACINE, pas sous `product`
  if (!brut.timelaps || !Array.isArray(brut.timelaps.domain_ids)) {
    fautes.push('la réponse de référence n’a plus la forme attendue : '
      + 'ce test ne prouve plus rien');
    return { notes, fautes };
  }
  notes.push(brut.timelaps.domain_ids.length + ' domaines dans la réponse de référence');

  // ═══════════════════════════════════════════════════════════════════════
  // AUCUN PHÉNOMÈNE NE DOIT S'AFFICHER SOUS SON NUMÉRO.
  //
  // C'est le garde-fou de la faute trouvée : « phénomène 9 » au lieu de
  // « vagues-submersion ». On relit TOUS les identifiants présents dans la
  // vraie réponse, pas seulement ceux qui sont en alerte aujourd'hui —
  // sinon le test ne verrait le trou que le jour où le phénomène s'allume,
  // c'est-à-dire le jour où ça compte.
  // ═══════════════════════════════════════════════════════════════════════
  const numeros = new Set();
  for (const d of brut.timelaps.domain_ids) {
    for (const p of d.phenomenon_items || []) numeros.add(Number(p.phenomenon_id));
  }
  notes.push('phénomènes présents dans le flux : ' + [...numeros].sort((a, b) => a - b).join(', '));

  for (const n of numeros) {
    // On force le phénomène en alerte pour que `interpreter` le nomme.
    const copie = JSON.parse(JSON.stringify(brut));
    for (const d of copie.timelaps.domain_ids) {
      if (d.domain_id !== 'VIGI987-13') continue;
      d.max_color_id = 3;
      for (const p of d.phenomenon_items || []) {
        p.phenomenon_max_color_id = (Number(p.phenomenon_id) === n) ? 3 : 1;
      }
    }
    const r = V.interpreter(copie, V.zonePour({ id: 'bora-bora' }));
    const noms = (r && r.phenomenes || []).map((p) => p.nom).join(', ');
    if (/phénomène \d/.test(noms)) {
      fautes.push('le phénomène ' + n + ' s’affiche sous son numéro (« ' + noms
        + ' ») : c’est un chiffre nu sur la ligne de sécurité de l’application');
    }
  }
  notes.push(numeros.size + ' phénomènes du flux, tous nommés en toutes lettres');

  // ── les neuf îles se lisent, et l'heure de mise à jour est reprise
  const vus = [];
  for (const [id, precise] of ILES) {
    const z = V.zonePour({ id });
    const r = V.interpreter(brut, z);
    if (!r) { fautes.push(id + ' : la réponse n’a pas pu être lue'); continue; }
    if (r.precise !== precise) {
      fautes.push(id + ' : « precise » vaut ' + r.precise + ' au lieu de ' + precise);
    }
    if (r.maj !== brut.update_time) {
      fautes.push(id + ' : l’heure de mise à jour n’est pas reprise du flux');
    }
    if (!r.etat || r.etat === 'inconnu') {
      fautes.push(id + ' : état « ' + r.etat + ' » sur une réponse valide');
    }
    vus.push(id + ' → ' + r.etat + (precise ? '' : ' (Polynésie entière)'));
  }
  notes.push(vus.join(' · '));

  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️  ET CE QUE CETTE RÉPONSE RÉVÈLE : LE REPLI SUR LE DOMAINE GLOBAL
  //     N'EST PAS « MOINS PRÉCIS », IL EST ALARMISTE.
  //
  // Le domaine VIGI987 est le MAXIMUM de tout le territoire. Le 28 août il
  // valait orange — à cause de Rapa seule, à mille cinq cents kilomètres
  // des Tuamotu. Les trois îles sans zone connue affichaient donc une
  // vigilance orange pour un phénomène qui ne les concernait pas.
  //
  // Ce test ne tranche pas ce que l'application doit faire : il refuse
  // seulement que ça se produise sans que personne le sache. Le jour où la
  // règle change, cette assertion changera avec elle, délibérément.
  // ═══════════════════════════════════════════════════════════════════════
  const global = brut.timelaps.domain_ids.find((d) => d.domain_id === 'VIGI987');
  const elevees = brut.timelaps.domain_ids
    .filter((d) => d.domain_id !== 'VIGI987' && Number(d.max_color_id) > 1)
    .map((d) => d.domain_id);

  if (global && Number(global.max_color_id) > 1) {
    notes.push('⚠️  le domaine global est au-dessus du vert (' + global.max_color_id
      + ') à cause de : ' + (elevees.join(', ') || 'aucune zone nommée')
      + ' — les îles sans zone connue héritent de ce niveau');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️  LES TREIZE SOUS-ZONES DES ÎLES DU VENT NE DOIVENT PAS ÊTRE MUETTES.
  //
  // La vraie réponse contient VIGI987-14-50 à -63, absents de toute
  // documentation reçue, rattachés aux seules Îles du Vent et ne portant
  // QUE le phénomène 9 — des secteurs côtiers, selon toute apparence.
  //
  // Le jour du relevé, la mère et ses treize secteurs étaient tous verts :
  // rien ne dit si la mère agrège ses secteurs. Si elle ne les agrège pas,
  // un secteur de Tahiti en orange submersion n'apparaîtrait nulle part.
  // On prend donc le maximum — et ce test le prouve en faisant passer un
  // seul secteur à l'orange, la mère restant au vert.
  // ═══════════════════════════════════════════════════════════════════════
  const sousZones = brut.timelaps.domain_ids
    .filter((d) => String(d.domain_id).startsWith('VIGI987-14-'));

  if (sousZones.length === 0) {
    fautes.push('la réponse de référence n’a plus de sous-zones : le cas des '
      + 'secteurs côtiers n’est plus éprouvé');
  } else {
    notes.push(sousZones.length + ' sous-zones des Îles du Vent, toutes sur le '
      + 'seul phénomène ' + [...new Set(sousZones.flatMap(
        (d) => (d.phenomenon_items || []).map((p) => p.phenomenon_id)))].join(', '));

    const copie = JSON.parse(JSON.stringify(brut));
    const cible = copie.timelaps.domain_ids.find((d) => d.domain_id === sousZones[0].domain_id);
    cible.max_color_id = 3;
    for (const p of cible.phenomenon_items || []) p.phenomenon_max_color_id = 3;

    const tahiti = V.interpreter(copie, V.zonePour({ id: 'tahiti' }));
    if (!tahiti || tahiti.etat !== 'orange') {
      fautes.push('un secteur côtier des Îles du Vent passé en orange laisse Tahiti à « '
        + (tahiti && tahiti.etat) + ' » : l’alerte de submersion est invisible');
    }
    if (!(tahiti.phenomenes || []).some((p) => /submersion|houle/.test(p.nom))) {
      fautes.push('Tahiti passe en orange sans pouvoir dire de quel phénomène — '
        + 'le niveau vient du secteur, la liste est restée celle de la zone mère');
    }
    const ailleurs = V.interpreter(copie, V.zonePour({ id: 'bora-bora' }));
    if (ailleurs.etat !== 'vert') {
      fautes.push('un secteur des Îles du Vent a fait bouger Bora Bora, '
        + 'qui est aux Îles Sous-le-Vent');
    }
    notes.push('un secteur côtier en alerte remonte à son île, et à elle seule');
  }

  // ── les zones en cause sont calculées, et seulement pour les îles floues
  const flou = V.interpreter(brut, V.zonePour({ id: 'rangiroa' }));
  const net = V.interpreter(brut, V.zonePour({ id: 'bora-bora' }));

  if (net.causes !== null) {
    fautes.push('une île dont la zone est connue porte quand même une liste de '
      + 'zones en cause : c’est du bruit, l’alerte la concerne directement');
  }
  if (!Array.isArray(flou.causes) || flou.causes.length === 0) {
    fautes.push('une île sans zone connue n’indique pas d’où vient l’alerte');
  } else {
    if (flou.causes.some((c) => c.zoneId === 'VIGI987')) {
      fautes.push('le domaine global figure parmi les zones en cause : '
        + 'il n’explique rien, il est la question');
    }
    if (flou.causes.some((c) => /^VIGI987/.test(String(c.zone)))) {
      fautes.push('une zone en cause s’affiche sous son identifiant brut au lieu '
        + 'de son nom — « ' + JSON.stringify(flou.causes) + ' »');
    }
    notes.push('zone(s) en cause : ' + flou.causes.map((c) => c.zone + ' ' + c.etat).join(', '));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ET L'ÉCRAN DOIT LE DIRE, PAS SEULEMENT LE PAQUET.
  //
  // Le champ `causes` ne sert à rien s'il n'atteint pas le bandeau. C'est
  // la même faute que la carte de l'île, qui a existé deux fois sans être
  // rendue : ce qu'un test ne regarde pas cesse d'exister sans bruit.
  // ═══════════════════════════════════════════════════════════════════════
  const { charger, aLApp, React, TR } = require('./harnais');
  if (aLApp()) {
    const B = charger('composants/BandeauVigilance');

    const mots = (n, out = []) => {
      if (n === null || n === undefined) return out;
      if (typeof n === 'string') { out.push(n); return out; }
      if (Array.isArray(n)) { for (const x of n) mots(x, out); return out; }
      if (n.children) mots(n.children, out);
      return out;
    };

    const ouvrir = (vigilance) => {
      const a = TR.create(React.createElement(B.default, { vigilance, nomIle: 'Rangiroa' }));
      const bouton = a.root.findAllByProps({ accessibilityRole: 'button' })[0];
      TR.act(() => bouton.props.onPress());
      const t = mots(a.toJSON()).join(' ').replace(/\s+/g, ' ');
      a.unmount();
      return t;
    };

    const texteFlou = ouvrir(flou);
    if (!/Rapa/.test(texteFlou)) {
      fautes.push('le bandeau ne nomme pas la zone d’où vient l’alerte : '
        + 'l’île affiche « orange » sans que rien ne dise que c’est Rapa');
    }
    if (!/zone exacte de cette île n’est pas connue/.test(texteFlou)) {
      fautes.push('le bandeau ne dit plus que la zone de l’île est inconnue');
    }
    // ⚠️  On ne fait pas dire au silence que l'île est hors de danger.
    if (/hors de danger|ne vous concerne pas|aucun risque ici/i.test(texteFlou)) {
      fautes.push('le bandeau conclut que l’alerte ne concerne pas l’île — '
        + 'sa zone est inconnue, on ne peut pas l’affirmer');
    }

    const texteNet = ouvrir(net);
    if (/Rapa|autres zones/.test(texteNet)) {
      fautes.push('le bandeau d’une île à zone connue parle d’autres zones');
    }
    notes.push('le bandeau nomme la zone en cause, sans conclure à la place du lecteur');
  }

  return { notes, fautes };
};
