/**
 * Mata'i — QUAND LES DONNÉES ONT VRAIMENT CHANGÉ.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * « MISE À JOUR À 18 H 43 » DOIT VOULOIR DIRE QUELQUE CHOSE.
 *
 * Le backend s'exécute toutes les heures. Il redemande à Open-Meteo, il
 * réécrit les fichiers, et il tamponne l'heure de passage. L'application
 * affichait donc « mis à jour il y a 5 minutes » vingt-quatre fois par
 * jour — parfaitement exact, et parfaitement trompeur.
 *
 * Parce qu'un modèle météo global ne sort PAS toutes les heures. L'ECMWF
 * tourne quatre fois par jour. Entre deux sorties, redemander vingt fois
 * la même prévision renvoie vingt fois la même prévision. L'utilisateur
 * qui lit « mis à jour il y a 5 minutes » croit avoir du neuf sous les
 * yeux ; il a une prévision de six heures, republiée.
 *
 * Ce n'est pas un détail cosmétique. Quelqu'un qui décide de sortir en mer
 * accorde du crédit à la fraîcheur affichée. Une fraîcheur fausse est un
 * crédit volé.
 *
 * Ce fichier compare donc le CONTENU, pas l'horaire :
 *
 *   — on prend l'empreinte des valeurs météo du paquet (et d'elles seules) ;
 *   — si elle est identique à celle du passage précédent, la date de mise
 *     à jour ne bouge pas, même si le fichier, lui, est réécrit ;
 *   — si elle diffère, c'est une vraie mise à jour, et elle est datée.
 *
 * ⚠️  L'EMPREINTE NE PORTE QUE SUR LES PRÉVISIONS.
 *
 * Pas sur `genere`, pas sur les images satellite, pas sur la vigilance :
 * ces trois-là bougent à chaque passage par construction, et les inclure
 * rendrait toute exécution « nouvelle ». On ne prend que ce qu'un modèle
 * météo produit — les heures des spots. C'est le piège de ce fichier, et
 * il n'est pas théorique : la première version incluait `genere` et
 * trouvait donc du neuf à chaque fois, ce qui revenait exactement au
 * comportement qu'elle devait corriger.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Nom du journal de fraîcheur, déposé à côté des paquets. */
const JOURNAL = 'fraicheur.json';

/**
 * L'empreinte des prévisions d'un paquet.
 *
 * On sérialise à la main plutôt que de hacher le JSON entier : ça garantit
 * qu'aucun champ ajouté plus tard (une image, un compteur, un identifiant
 * de build) ne se glisse dans l'empreinte sans qu'on l'ait décidé.
 */
export function empreinte(paquet) {
  const h = createHash('sha1');
  for (const spot of paquet.spots || []) {
    h.update('|' + spot.id);
    for (const e of spot.heures || []) {
      h.update([
        e.t, e.vent, e.rafale, e.dir, e.pluie, e.temp, e.ciel,
        e.houle, e.periode, e.houleDir, e.swell, e.swellPer, e.swellDir
      ].join(','));
    }
  }
  return h.digest('hex').slice(0, 16);
}

/** Lit le journal du passage précédent. Absent = premier passage. */
export async function lireJournal(dossier) {
  try {
    return JSON.parse(await readFile(join(dossier, JOURNAL), 'utf8'));
  } catch (e) {
    return {};
  }
}

export async function ecrireJournal(dossier, journal) {
  await mkdir(dossier, { recursive: true });
  await writeFile(join(dossier, JOURNAL), JSON.stringify(journal, null, 1), 'utf8');
}

/**
 * La prochaine exécution prévue.
 *
 * ⚠️  ON ANNONCE LE PROCHAIN PASSAGE, PAS LA PROCHAINE DONNÉE NEUVE.
 *
 * On ne sait pas quand le modèle sortira sa prochaine version — c'est chez
 * l'ECMWF que ça se décide. On sait en revanche quand on ira regarder. La
 * phrase de l'application dit donc « prochaine vérification », et le
 * libellé compte : promettre « prochaine mise à jour à 00 h 54 » alors
 * qu'on ne fait que reposer la question serait le même mensonge, déplacé
 * d'une heure.
 *
 * La cadence réelle est d'une exécution par heure : c'est le seul horaire
 * que le planificateur de GitHub honore sur ce dépôt. Mesuré, pas supposé —
 * une cadence de vingt minutes et une cadence à 5, 25 et 45 minutes n'ont
 * jamais déclenché.
 *
 * (Les deux cadences ci-dessus ne sont pas écrites en syntaxe cron ici : un
 * astérisque suivi d'une barre oblique FERME ce commentaire de bloc, et le
 * fichier ne compile plus. Attrapé au premier lancement.)
 */
export function prochainPassage(maintenant = new Date(), minutesCadence = 60) {
  const t = maintenant.getTime();
  const pas = minutesCadence * 60000;
  return new Date(Math.ceil((t + 60000) / pas) * pas);
}

/**
 * Décide de la date de mise à jour à publier pour une île.
 *
 * @returns { majReelle, prochaine, change, empreinte }
 */
export function dater(paquet, journalIle, maintenant = new Date(), minutesCadence = 60) {
  const e = empreinte(paquet);
  const inchange = journalIle && journalIle.empreinte === e && journalIle.majReelle;

  return {
    empreinte: e,
    change: !inchange,
    majReelle: inchange ? journalIle.majReelle : maintenant.toISOString(),
    prochaine: prochainPassage(maintenant, minutesCadence).toISOString(),
    // Combien de passages de suite ont trouvé la même chose. C'est une
    // information utile en soi : « republié 6 fois sans changement » dit à
    // l'utilisateur averti que le modèle n'a pas bougé depuis six heures.
    republications: inchange ? ((journalIle.republications || 0) + 1) : 0
  };
}
