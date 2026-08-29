/**
 * Mata'i — la hauteur du soleil, côté serveur.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ALORS QUE L'APPLICATION SAIT DÉJÀ LE FAIRE.
 *
 * L'application a `src/soleil.js`, éprouvé contre une seconde
 * implémentation et contre des horaires publiés. Mais il vit dans un autre
 * paquet, il importe `./lune` sans extension, et il est écrit pour un
 * téléphone. Le serveur n'a besoin que d'un chiffre : à quelle hauteur est
 * le soleil au-dessus d'un point, à un instant donné.
 *
 * ⚠️  DEUX IMPLÉMENTATIONS D'UNE MÊME FORMULE, C'EST UNE DETTE — SAUF SI
 *     ELLES SE CONTRÔLENT MUTUELLEMENT.
 *
 * Celle-ci ne recopie pas celle de l'application : elle suit la voie du
 * calculateur solaire de la NOAA (année fractionnaire → équation du temps →
 * angle horaire), là où l'application passe par la longitude écliptique
 * apparente puis les coordonnées équatoriales. Deux chemins différents vers
 * le même nombre.
 *
 * `tests/27-soleil-serveur.js` les compare sur une grille de dates et de
 * lieux. Tant qu'elles s'accordent, chacune contrôle l'autre ; le jour où
 * elles divergent, l'essai le dit avant que l'imagerie ne bascule au
 * mauvais moment.
 *
 * PRÉCISION : le dixième de degré suffit ici. Ce fichier sert à décider si
 * une image satellite est encore éclairée, pas à calculer une heure de
 * coucher — ça, c'est le travail de l'application, avec sa précision à la
 * minute et ses vérifications.
 * ═══════════════════════════════════════════════════════════════════════
 */

const RAD = Math.PI / 180;

/**
 * Hauteur du soleil au-dessus de l'horizon, en degrés.
 *
 * Négatif quand le soleil est couché. Ne corrige ni la réfraction ni le
 * demi-diamètre apparent : on veut la position géométrique du centre, et
 * les seuils qui l'utilisent sont calés sur des mesures de luminance, pas
 * sur une définition du coucher.
 *
 * @param date  instant, en Date (UTC)
 * @param lat   latitude en degrés, positive vers le nord
 * @param lon   longitude en degrés, positive vers l'est
 */
export function hauteurSoleil(date, lat, lon) {
  // Année fractionnaire, en radians. Le quantième se compte depuis le
  // 1er janvier = jour 1, comme dans la note de la NOAA.
  const debutAnnee = Date.UTC(date.getUTCFullYear(), 0, 1);
  const jour = Math.floor((date.getTime() - debutAnnee) / 86400000) + 1;
  const heure = date.getUTCHours() + date.getUTCMinutes() / 60
              + date.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (jour - 1 + (heure - 12) / 24);

  // Équation du temps, en minutes : l'écart entre le midi solaire vrai et
  // le midi moyen. Elle atteint un quart d'heure en novembre — assez pour
  // décaler une bascule d'imagerie si on l'oubliait.
  const equationDuTemps = 229.18 * (
      0.000075
    + 0.001868 * Math.cos(g)
    - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g)
    - 0.040849 * Math.sin(2 * g));

  // Déclinaison du soleil, en radians.
  const declinaison =
      0.006918
    - 0.399912 * Math.cos(g)
    + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g)
    + 0.001480 * Math.sin(3 * g);

  // On travaille en UTC, donc le décalage de fuseau est nul et il ne reste
  // que la longitude : quatre minutes par degré.
  const decalageMin = equationDuTemps + 4 * lon;
  const vraiTempsSolaire = heure * 60 + decalageMin;

  // Angle horaire : zéro au midi solaire vrai, quinze degrés par heure.
  const angleHoraire = (vraiTempsSolaire / 4) - 180;

  const cosZenith =
      Math.sin(lat * RAD) * Math.sin(declinaison)
    + Math.cos(lat * RAD) * Math.cos(declinaison) * Math.cos(angleHoraire * RAD);

  // Le cosinus peut sortir de [-1, 1] d'un cheveu par arrondi ; acos rendrait
  // NaN, et un NaN qui traverse une comparaison de seuil la rend toujours
  // fausse — l'imagerie resterait bloquée sur un canal sans rien dire.
  const borne = Math.max(-1, Math.min(1, cosZenith));
  return 90 - Math.acos(borne) / RAD;
}

/**
 * La plus basse hauteur du soleil sur un ensemble de points, à un instant.
 *
 * ⚠️  C'EST LE MINIMUM QUI DÉCIDE, PAS LE CENTRE.
 *
 * L'emprise publiée fait deux mille quatre cents kilomètres et vingt et un
 * degrés de latitude : le soleil se couche sur les Marquises alors qu'il
 * éclaire encore les Australes. Prendre le centre laisserait un coin de
 * l'image dans le noir sans que rien ne le signale — c'est exactement la
 * panne qu'on est en train de réparer, en plus discret.
 */
export function hauteurMinimale(date, points) {
  let min = Infinity;
  for (const p of points) {
    const h = hauteurSoleil(date, p.lat, p.lon);
    if (h < min) min = h;
  }
  return min;
}
