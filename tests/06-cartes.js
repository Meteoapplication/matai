/**
 * Les cartes d'île : une par île, et rien qui déborde.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * L'écran Carte garde un bloc de repli, « Carte à dessiner », pour une île
 * qu'on ajouterait sans trait de côte : mieux vaut ne rien montrer qu'un
 * dessin faux quand il s'agit de naviguer.
 *
 * Ce repli doit rester un GARDE-FOU, jamais le cas normal. Sans ce test,
 * ajouter une dixième île sans son contour ne casserait rien et ne dirait
 * rien : elle afficherait poliment « carte à dessiner » et personne ne le
 * remarquerait avant qu'un utilisateur s'en plaigne.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * On vérifie aussi ce qui a déjà mordu :
 *   — chaque point de mesure tient dans le cadre, ou porte un chevron qui
 *     dit « c'est plus loin par là » (les DCP mouillés au large) ;
 *   — l'attribution OpenStreetMap est présente. Ce n'est pas de la
 *     politesse, c'est la condition de la licence ODbL ;
 *   — le calcul d'abri se tait sur les atolls, où la notion d'intérieur
 *     n'existe pas.
 */

const fs = require('fs');
const path = require('path');
const { charger, monter, texte, aLApp } = require('./harnais');

/** Distance en kilomètres entre deux points. */
function km(a, b) {
  const R = 6371;
  const dl = (b.lat - a.lat) * Math.PI / 180;
  const dg = (b.lon - a.lon) * Math.PI / 180;
  const m = Math.sin(dl/2) ** 2
    + Math.cos(a.lat * Math.PI/180) * Math.cos(b.lat * Math.PI/180) * Math.sin(dg/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(m));
}

/**
 * Le point est-il à l'intérieur du polygone ? Lancer de rayon : on compte les
 * fois où une demi-droite partant du point traverse le contour. Nombre impair
 * = dedans.
 */
function dansPolygone(p, poly) {
  let dedans = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.lat > p.lat) !== (b.lat > p.lat))
      && (p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon)) {
      dedans = !dedans;
    }
  }
  return dedans;
}

/** Distance d'un point au trait de côte le plus proche d'une île. */
function versCote(p, terres) {
  let d = Infinity;
  for (const t of terres) for (const q of t) { const x = km(p, q); if (x < d) d = x; }
  return d;
}

module.exports = function () {
  if (!aLApp()) return { saute: 'sources de l’application absentes' };

  const CarteIle = charger('composants/CarteIle').default;
  const contours = charger('contours');
  const OuAller = charger('composants/OuAller');
  const donnees = charger('donnees');

  const registre = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'spots.json'), 'utf8')
  );
  const dossier = path.resolve(__dirname, '..', 'paquets');

  const notes = [];
  const fautes = [];
  let dessinees = 0;

  for (const ile of registre.iles) {
    if (!contours.aUnContour(ile.id)) {
      fautes.push(ile.nom + ' : aucun trait de côte — l’écran Carte tombera sur son repli');
      continue;
    }

    const fichier = path.join(dossier, ile.id + '.json');
    if (!fs.existsSync(fichier)) {
      notes.push(ile.nom + ' : pas de paquet sous la main, contour vérifié seulement');
      dessinees++;
      continue;
    }

    const p = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    p.ile = p.ile || ile.id;

    let mer;
    try {
      mer = OuAller.merDuMoment(p, donnees.depuisMaintenant);
    } catch (e) {
      fautes.push(ile.nom + ' : merDuMoment a échoué — ' + e.message);
      continue;
    }

    let arbre;
    try {
      arbre = monter(CarteIle, { ile: p, houleDir: mer.dir, houle: mer.hauteur });
    } catch (e) {
      fautes.push(ile.nom + ' : la carte ne se monte pas — ' + e.message);
      continue;
    }
    if (!arbre) {
      fautes.push(ile.nom + ' : la carte ne rend rien alors qu’un contour existe');
      continue;
    }

    const txt = texte(arbre).join(' ');
    if (!/OpenStreetMap/.test(txt)) {
      fautes.push(ile.nom + ' : attribution OpenStreetMap absente (licence ODbL)');
    }

    // Les points de mesure doivent tenir dans le cadre ; ceux qui n'y tiennent
    // pas sont ramenés au bord et dessinés en chevron — jamais en rond, qui
    // se lirait « c'est ici ».
    const c = contours.contour(ile.id);
    const spots = (p.spots || []).filter(
      (s) => typeof s.lat === 'number' && typeof s.lon === 'number'
    );
    const proj = contours.projeter(c.terres, 332, 300, 16, spots);
    if (!proj) {
      fautes.push(ile.nom + ' : la projection échoue');
      continue;
    }
    for (const s of spots) {
      const q = proj.pointBorne(s.lat, s.lon);
      const dedans = q.x >= 0 && q.x <= 332 && q.y >= 0 && q.y <= 300;
      if (!dedans) {
        fautes.push(ile.nom + ' / ' + s.nom + ' : dessiné hors du cadre ('
          + Math.round(q.x) + ', ' + Math.round(q.y) + ')');
      }
      if (q.loin && !q.vers) {
        fautes.push(ile.nom + ' / ' + s.nom + ' : ramené au bord sans direction à indiquer');
      }
    }

    dessinees++;
  }

  notes.unshift(dessinees + '/' + registre.iles.length + ' îles tracées d’après OpenStreetMap');

  /* ═══════════════════════════════════════════════════════════════════════
   * UN RÉCIF NE DOIT PAS APPARTENIR À L'ÎLE D'À CÔTÉ.
   *
   * Les récifs sont récupérés par boîte englobante autour de chaque île, et
   * une boîte attrape les voisines : trois lignes du récif de MOOREA se sont
   * retrouvées classées sous Tahiti, et deux atolls voisins (Toau, Tahanea)
   * sous Fakarava. À l'écran, ça donne des bouts de récif flottant au large,
   * sans île — exactement l'artefact qu'on prendrait pour une erreur de
   * projection.
   *
   * Le contrôle : chaque ligne de récif doit être plus proche de SON île que
   * de toute autre île du registre. C'est le test qui attrape le cas Moorea /
   * Tahiti pour de bon, et il ne dépend d'aucun seuil arbitraire.
   * ═══════════════════════════════════════════════════════════════════════ */
  const recifs = charger('recifs');
  const cotes = {};
  for (const ile of registre.iles) {
    const c = contours.contour(ile.id);
    if (c) cotes[ile.id] = c.terres;
  }

  for (const ile of registre.iles) {
    const lignes = recifs.recif(ile.id);
    if (!lignes) continue;

    let plusLoin = 0;
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      const milieu = l[Math.floor(l.length / 2)];
      const sien = versCote(milieu, cotes[ile.id] || []);
      if (sien > plusLoin) plusLoin = sien;

      for (const autre of registre.iles) {
        if (autre.id === ile.id || !cotes[autre.id]) continue;
        if (versCote(milieu, cotes[autre.id]) < sien) {
          fautes.push(ile.nom + ' : la ligne de récif nº' + i + ' est plus proche de '
            + autre.nom + ' — elle appartient à l’île d’à côté');
          break;
        }
      }
    }
    notes.push(ile.nom + ' : récif en ' + lignes.length
      + ' ligne(s), la plus éloignée à ' + plusLoin.toFixed(1) + ' km de la côte');
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * AUCUN POINT DE MESURE NE DOIT ÊTRE POSÉ SUR LA TERRE.
   *
   * Deux l'étaient — « Baie de Phaéton » et « Rikitea », tous deux de type
   * lagon — et rien ne le signalait : Open-Meteo ne renvoie pas d'erreur pour
   * un point à terre, il rabat la demande sur la case de mer la plus proche.
   * L'application affichait donc une houle parfaitement plausible, mesurée à
   * un endroit qu'elle ne nommait pas, et dessinait un rond au milieu d'une
   * île.
   *
   * C'est le pire genre de défaut : silencieux, et impossible à voir sans
   * confronter la coordonnée à une géométrie. On l'a maintenant.
   * ═══════════════════════════════════════════════════════════════════════ */
  for (const ile of registre.iles) {
    const terres = cotes[ile.id];
    if (!terres) continue;
    for (const sp of ile.spots || []) {
      if (typeof sp.lat !== 'number' || typeof sp.lon !== 'number') continue;
      const p = { lat: sp.lat, lon: sp.lon };
      // On ignore les contours minuscules : un motu de trois points est plus
      // souvent un artefact de simplification qu'une terre à éviter.
      if (terres.some((t) => t.length > 3 && dansPolygone(p, t))) {
        fautes.push(ile.nom + ' / ' + sp.nom + ' : le point de mesure est SUR LA TERRE'
          + ' — la prévision qu’il renvoie vient d’ailleurs, sans le dire');
      }
    }
  }

  // Un atoll est une guirlande de bandes de sable ouvertes : la normale au
  // large n'y a pas de sens, et le calcul rendrait des façades exposées au
  // hasard. Il doit se taire.
  const abri = charger('abri');
  for (const ile of registre.iles) {
    if (!contours.estAtoll(ile.id)) continue;
    if (abri.exposition(ile.id, 180) !== null) {
      fautes.push(ile.nom + ' : atoll, mais le calcul d’abri répond quand même');
    }
  }

  return { notes, fautes };
};
