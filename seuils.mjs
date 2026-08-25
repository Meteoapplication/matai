/**
 * Mata'i — les seuils qui décident du vert, de l'ambre et du rouge.
 *
 * C'EST LE SEUL FICHIER QUI DÉCIDE. L'application et le backend
 * l'utilisent tous les deux, pour qu'un pêcheur ne puisse jamais voir
 * une couleur différente de celle qui a été calculée.
 *
 * Les valeurs ci-dessous sont PROVISOIRES. Elles viennent d'une
 * estimation, pas de l'expérience de quelqu'un qui sort en mer.
 * Elles doivent être corrigées après les entretiens avec les pêcheurs
 * et les prestataires. Quand tu les changes, tu changes tout le produit.
 */

export const SEUILS = {
  // Dans le lagon, le récif absorbe la houle du large : seul le vent compte.
  lagon: {
    ventOk: 20,
    ventLimite: 28
  },

  // Dans la passe, une houle longue déferle sur le seuil bien avant
  // qu'elle ne gêne au large : la période pèse autant que la hauteur.
  passe: {
    ventOk: 18,
    ventLimite: 25,
    houleOk: 1.8,
    houleLimite: 2.8,
    periodeLongue: 13,
    houleLongueOk: 1.5
  },

  // Au large : ni abri ni seuil, hauteur et vent bruts.
  large: {
    ventOk: 18,
    ventLimite: 24,
    houleOk: 2.0,
    houleLimite: 3.0
  }
};

/**
 * Pour éviter que les barres horaires clignotent quand le vent oscille
 * autour d'un seuil : une heure ne repasse au vert que si elle est
 * franchement sous le seuil, pas juste un dixième en dessous.
 */
const MARGE = 1.5;

/**
 * @param {{vent:number|null, houle:number|null, periode:number|null}} h
 * @param {'lagon'|'passe'|'large'} type
 * @param {'ok'|'mid'|'no'|null} precedent - catégorie de l'heure d'avant
 * @returns {'ok'|'mid'|'no'|'inconnu'}
 */
export function categorie(h, type, precedent = null) {
  const s = SEUILS[type];
  if (!s) throw new Error(`Type de spot inconnu : ${type}`);

  const vent = h.vent;
  if (vent === null || vent === undefined || Number.isNaN(vent)) return 'inconnu';

  // hystérésis : on ne remonte au vert qu'avec de la marge
  const sortaitDuVert = precedent && precedent !== 'ok';
  const ventOk = sortaitDuVert ? s.ventOk - MARGE : s.ventOk;

  if (type === 'lagon') {
    if (vent < ventOk) return 'ok';
    if (vent < s.ventLimite) return 'mid';
    return 'no';
  }

  const houle = h.houle;
  if (houle === null || houle === undefined || Number.isNaN(houle)) return 'inconnu';

  if (type === 'passe') {
    const p = h.periode;
    const longue = p !== null && p !== undefined && p >= s.periodeLongue;
    const deferle = longue && houle >= s.houleLongueOk;
    if (vent < ventOk && houle < s.houleOk && !deferle) return 'ok';
    if (vent < s.ventLimite && houle < s.houleLimite) return 'mid';
    return 'no';
  }

  if (vent < ventOk && houle < s.houleOk) return 'ok';
  if (vent < s.ventLimite && houle < s.houleLimite) return 'mid';
  return 'no';
}

/**
 * Applique categorie() à une suite d'heures, en gardant la mémoire de
 * l'heure précédente pour l'hystérésis, et trouve la fenêtre de sortie.
 *
 * @returns {{heures:Array, cat:string, ferme:string|null, ouvre:string|null}}
 */
export function analyser(heures, type) {
  let precedent = null;
  const avecCat = heures.map((h) => {
    const c = categorie(h, type, precedent);
    precedent = c;
    return { ...h, cat: c };
  });

  const maintenant = avecCat[0] ? avecCat[0].cat : 'inconnu';

  // première heure qui quitte le vert
  let ferme = null;
  if (maintenant === 'ok') {
    const q = avecCat.find((h) => h.cat !== 'ok');
    ferme = q ? q.t : null;
  }

  // si c'est fermé maintenant, quand est-ce que ça rouvre
  let ouvre = null;
  if (maintenant !== 'ok') {
    const q = avecCat.find((h) => h.cat === 'ok');
    ouvre = q ? q.t : null;
  }

  return { heures: avecCat, cat: maintenant, ferme, ouvre };
}
