/**
 * La bande de l'écran satellite : ce qui a le droit d'être montré comme
 * « le ciel », et ce qui n'en a pas le droit.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LE POINT 8 DU CAHIER DES CHARGES EN UN SEUL ENDROIT.
 *
 * « Toujours distinguer OBSERVATION / PRÉVISION / PROJECTION IA. » Sur
 * l'écran satellite, cette distinction se joue dans une seule fonction :
 * celle qui assemble la bande d'images. Elle décide, pour chaque vignette,
 * si elle est une photographie du ciel ou une image que nous avons
 * fabriquée.
 *
 * ⚠️  ELLE VIVAIT DANS UN `useMemo`, DONC HORS D'ATTEINTE.
 *
 * Tant que la règle était enfermée dans le composant, l'éprouver demandait
 * de monter tout l'écran — avec son SVG, sa carte, son minuteur. Personne ne
 * l'a fait, et le trou ci-dessous a vécu depuis le premier jour.
 *
 * ⚠️  LE TROU : SIX IMAGES INVENTÉES ET RIEN D'AUTRE.
 *
 * La condition d'affichage tolérait l'absence de comparaison :
 *
 *     (!projection.dernierObserve || !derniereObs
 *       || projection.dernierObserve === derniereObs)
 *
 * — à défaut de pouvoir comparer, on affiche. Or `derniereObs` est nul dès
 * que l'animation n'est pas en main : requête échouée, premier lancement sur
 * une mauvaise liaison, cache vidé. Si une projection traîne, elle, dans le
 * cache — les deux index sont chargés et mis en cache SÉPARÉMENT, ce qui
 * rend ce désaccord ordinaire — alors la bande devient six images calculées,
 * qui défilent seules à la place du satellite.
 *
 * Elles portent leur bandeau incrusté, « PROJECTION · +10 min ». Après quoi ?
 * Aucune image réelle n'est là pour le dire. Sur un atoll où une requête sur
 * deux passe — la situation même pour laquelle cette application existe —
 * quelqu'un regarderait une heure de ciel inventé en croyant voir le ciel.
 * ═══════════════════════════════════════════════════════════════════════
 */

const { charger, aLApp } = require('./harnais');

/** Un index d'animation réel, tel que le backend l'écrit. */
const ANIM = {
  images: [
    { fichier: 'nuages/anim/20262400110.jpg', t: '2026-08-28T01:10:00.000Z' },
    { fichier: 'nuages/anim/20262400220.jpg', t: '2026-08-28T02:20:00.000Z' },
    { fichier: 'nuages/anim/20262400300.jpg', t: '2026-08-28T03:00:00.000Z' }
  ]
};

/** Une projection réelle, bâtie sur la dernière image de ANIM. */
const PROJ = {
  nature: 'projection',
  dernierObserve: '20262400300',
  images: [
    { fichier: '20262400310.jpg', horodatage: '20262400310', minutes: 10 },
    { fichier: '20262400320.jpg', horodatage: '20262400320', minutes: 20 }
  ]
};

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const M = charger('ecrans/Ciel');
  const fautes = [];
  const notes = [];

  if (typeof M.construireBande !== 'function') {
    fautes.push('ecrans/Ciel n’expose plus « construireBande » : la règle qui '
      + 'décide ce qui s’affiche comme le ciel redevient inéprouvable');
    return { notes, fautes };
  }

  const B = M.construireBande;
  const nb = (r, quoi) => r.images.filter((x) => x.nature === quoi).length;

  // ── le cas normal : trois observées, puis deux projetées
  {
    const r = B(ANIM, PROJ, 'https://exemple');
    if (nb(r, 'observation') !== 3 || nb(r, 'projection') !== 2) {
      fautes.push('cas normal : ' + nb(r, 'observation') + ' observée(s) et '
        + nb(r, 'projection') + ' projetée(s) au lieu de 3 et 2');
    }
    // Les projetées viennent APRÈS, et de leur propre dossier.
    const p = r.images.filter((x) => x.nature === 'projection');
    for (const x of p) {
      if (!x.url.includes('/nuages/projection/')) {
        fautes.push('une image projetée est servie depuis « ' + x.url
          + ' » : les deux dossiers ne doivent jamais se croiser');
      }
    }
    const o = r.images.filter((x) => x.nature === 'observation');
    for (const x of o) {
      if (!/\/nuages\/anim(-ir)?\//.test(x.url)) {
        fautes.push('une image observée est servie depuis « ' + x.url + ' »');
      }
      if (x.url.includes('nuages/anim/nuages')) {
        fautes.push('chemin doublé dans l’URL d’une observation : « ' + x.url
          + ' » — l’index porte des chemins, pas des noms nus');
      }
    }
    notes.push('cas normal : 3 observations puis 2 projections, chacune depuis son dossier');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ── ⚠️  LA NUIT : LE DOSSIER SE LIT, IL NE SE DEVINE PAS
  //
  // Depuis que l'imagerie bascule en infrarouge la nuit, l'index sert deux
  // dossiers. `construireBande` reconstruisait le chemin à partir du seul
  // NOM du fichier, en supposant `nuages/anim/` : elle aurait redemandé
  // l'image visible — celle qui est noire — exactement pour les heures que
  // la bascule existe pour réparer.
  //
  // Rien ne l'aurait signalé. L'image existe, elle se charge, elle est
  // simplement noire, et l'écran d'accueil (qui lit `im.fichier`) aurait
  // continué de bien marcher pendant que cette page-là se taisait.
  // ═════════════════════════════════════════════════════════════════════
  {
    const nuit = { images: [
      { fichier: 'nuages/anim-ir/20262410400.jpg', t: '2026-08-29T04:00:00.000Z', canal: 'infrarouge' },
      { fichier: 'nuages/anim-ir/20262410410.jpg', t: '2026-08-29T04:10:00.000Z', canal: 'infrarouge' }
    ] };
    const r = B(nuit, null, 'https://x/paquets');
    const mauvaises = r.images.filter((x) => !x.url.includes('/nuages/anim-ir/'));
    if (mauvaises.length) {
      fautes.push('LA NUIT, LA BANDE VA CHERCHER LE MAUVAIS DOSSIER : « '
        + mauvaises[0].url + ' » au lieu de nuages/anim-ir/. C’est l’image '
        + 'VISIBLE, celle qui est noire — donc le carré noir revient sur cette '
        + 'page pendant que l’accueil, lui, affiche bien l’infrarouge. Aucune '
        + 'erreur ne serait remontée : le fichier existe et se charge.');
    }

    // Le crépuscule : la bande est à cheval, chaque image doit aller dans SON
    // dossier — pas tout l'un ni tout l'autre.
    const mixte = { images: [
      { fichier: 'nuages/anim/20262410300.jpg', t: '2026-08-29T03:00:00.000Z', canal: 'visible' },
      { fichier: 'nuages/anim-ir/20262410310.jpg', t: '2026-08-29T03:10:00.000Z', canal: 'infrarouge' }
    ] };
    const m = B(mixte, null, 'https://x/paquets');
    if (!m.images[0].url.endsWith('/nuages/anim/20262410300.jpg')
        || !m.images[1].url.endsWith('/nuages/anim-ir/20262410310.jpg')) {
      fautes.push('bande du crépuscule mal aiguillée : '
        + m.images.map((x) => x.url).join(' · '));
    }

    // Et une entrée ancienne, sans chemin, doit toujours marcher.
    const vieux = { images: [{ horodatage: '20262410300' }] };
    const v = B(vieux, null, 'https://x/paquets');
    if (!v.images.length || !v.images[0].url.endsWith('/nuages/anim/20262410300.jpg')) {
      fautes.push('une entrée ancienne sans `fichier` ne retombe plus sur '
        + 'nuages/anim/ : ' + JSON.stringify(v.images));
    }
    if (!fautes.length) {
      notes.push('la nuit → anim-ir, le crépuscule → chaque image dans son '
        + 'dossier, une entrée ancienne → anim/ comme avant');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ⚠️  LE CŒUR DE CE FICHIER : CE QUI DOIT ÊTRE REFUSÉ.
  //
  // Chaque ligne ci-dessous est une situation où l'application ne peut PAS
  // établir que la projection prolonge bien les images qu'elle affiche. Dans
  // toutes, la réponse est la même : on n'affiche aucune image projetée.
  // ═════════════════════════════════════════════════════════════════════
  const REFUS = [
    ['aucune observation en main (requête animation échouée, projection en cache)',
      null, PROJ,
      'la bande deviendrait SIX IMAGES INVENTÉES ET RIEN D’AUTRE — elles '
      + 'défileraient à la place du satellite, sans une seule image réelle '
      + 'pour dire de quand elles partent'],

    ['animation vide', { images: [] }, PROJ,
      'même chose : rien d’observé, tout d’inventé'],

    ['animation aux entrées abîmées', { images: [null, {}, { fichier: '' }] }, PROJ,
      'aucun nom exploitable : il n’y a pas d’observation, donc pas de socle'],

    ['projection sans « dernierObserve »', ANIM,
      { nature: 'projection', images: PROJ.images },
      'on ne peut pas vérifier qu’elle parle du même moment ; « inconnu » '
      + 'n’est pas « d’accord » — c’est la forme exacte du défaut de la '
      + 'vigilance, où un niveau inconnu devenait vert'],

    ['projection bâtie sur une image plus ancienne', ANIM,
      { ...PROJ, dernierObserve: '20262400220' },
      'elle décrit une heure déjà passée et s’afficherait « dans 10 minutes »'],

    ['index qui ne se déclare pas projection', ANIM,
      { ...PROJ, nature: 'animation' },
      'un index d’observations affiché sous l’étiquette « projection », ou '
      + 'l’inverse'],

    ['projection sans images', ANIM, { ...PROJ, images: [] }, 'rien à montrer'],
    ['projection absente', ANIM, null, 'le cas ordinaire quand le backend refuse'],
    ['projection nulle et animation nulle', null, null, 'écran vide au démarrage']
  ];

  for (const [quoi, anim, proj, pourquoi] of REFUS) {
    let r;
    try {
      r = B(anim, proj, 'https://exemple');
    } catch (e) {
      fautes.push(quoi + ' : la construction a planté — ' + e.message);
      continue;
    }
    const projetees = nb(r, 'projection');
    if (projetees > 0 || r.projectionAJour) {
      fautes.push('« ' + quoi + ' » : ' + projetees + ' image(s) projetée(s) '
        + 'affichée(s). ' + pourquoi);
    }
  }
  notes.push(REFUS.length + ' situations où la projection doit être écartée, toutes écartées');

  // ── et le refus ne doit pas emporter les observations avec lui
  {
    const r = B(ANIM, { ...PROJ, dernierObserve: '20262400220' }, 'https://exemple');
    if (nb(r, 'observation') !== 3) {
      fautes.push('une projection périmée fait aussi disparaître les images '
        + 'OBSERVÉES : on perdrait le satellite réel pour une projection '
        + 'refusée');
    } else {
      notes.push('une projection refusée laisse les 3 observations à l’écran');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ⚠️  ET AUCUNE IMAGE NE DOIT SORTIR SANS NATURE.
  //
  // Tout l'écran décide d'après ce champ : l'étiquette, la couleur du
  // bandeau, le libellé d'accessibilité. Une entrée sans nature serait
  // affichée comme une observation par défaut — c'est-à-dire une image
  // calculée présentée comme une photographie.
  // ═════════════════════════════════════════════════════════════════════
  {
    const r = B(ANIM, PROJ, 'https://exemple');
    for (const x of r.images) {
      if (x.nature !== 'observation' && x.nature !== 'projection') {
        fautes.push('une image de la bande porte la nature « ' + x.nature
          + ' » : l’écran ne saurait pas si elle a été photographiée ou calculée');
      }
      if (!x.horodatage) {
        fautes.push('une image de la bande n’a pas d’horodatage : l’heure '
          + 'affichée sous la vignette serait vide ou fausse');
      }
    }
    notes.push('les ' + r.images.length + ' entrées portent une nature et un horodatage');
  }

  return { notes, fautes };
};
