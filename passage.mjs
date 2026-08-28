/**
 * Mata'i — CE QUI FAIT ÉCHOUER UN PASSAGE, ET CE QUI NE LE FAIT PAS.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  UN POINT QUI TOMBE N'ARRÊTE PAS LA PUBLICATION.
 *
 * `build.mjs` finissait par cette ligne :
 *
 *     if (echecs > 0) process.exitCode = 1;
 *
 * Vingt et un points sont interrogés un par un. Un seul qui n'obtient pas
 * de réponse — un 502 d'Open-Meteo, une seconde de réseau, une maille qui
 * bronche — et la fabrication sortait en échec. Le pas suivant du flux
 * GitHub, celui qui publie, ne s'exécutait donc jamais.
 *
 * Le résultat n'est pas « on saute une heure ». Le site RESTE FIGÉ, à
 * l'heure de la dernière fois où les vingt et un points ont tous répondu du
 * premier coup, et il y reste jusqu'à ce que ça se reproduise. Le 28 août,
 * le site servait encore le paquet du 26 à 19 h 53 : trente heures
 * d'immobilité pour, très probablement, un point sur vingt et un.
 *
 * C'est le contraire de ce que l'intention voulait. « Mieux vaut vieux que
 * faux » — l'idée est juste, elle est écrite dans le flux GitHub, et elle
 * parle de données FAUSSES. Vingt points frais et un absent ne sont pas des
 * données fausses : c'est une île qui garde le paquet de l'heure d'avant,
 * ce que l'application sait déjà dire, puisqu'elle affiche l'âge de chaque
 * paquet et le marque « dépassé » au-delà.
 *
 * ⚠️  ET « RIEN » N'EST PAS « UN PEU MOINS ».
 *
 * La règle inverse serait aussi fausse : publier quoi qu'il arrive. Si
 * aucune île n'a pu être fabriquée, il n'y a rien à mettre en ligne, et
 * écraser le site avec un dossier vide effacerait des données correctes au
 * profit de rien. Dans ce cas on échoue, le pas de publication ne s'exécute
 * pas, et le site garde ce qu'il a.
 *
 *   aucune île écrite  → échec. Panne réelle, le site garde ce qu'il a.
 *   au moins une île   → succès. On publie ce qui est bon, et les îles non
 *                        refaites gardent leur paquet précédent, avec leur
 *                        propre date, que l'écran montre.
 *
 * Les points tombés sont écrits dans le paquet de leur île, sous
 * `manquants` : rien ne disparaît en silence.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * @param ilesPubliees  nombre d'îles réellement écrites dans paquets/
 * @param perdus        libellés des points sans réponse, pour le journal
 * @param verif         vrai en mode --verif : on ne publie rien de toute façon
 * @returns { code, lignes }  le code de sortie, et ce qu'il faut écrire
 */
export function verdictDePassage({ ilesPubliees = 0, perdus = [], verif = false } = {}) {
  const lignes = [];

  if (perdus.length) {
    lignes.push('');
    lignes.push(`⚠️  ${perdus.length} point(s) sans réponse ce passage :`);
    for (const p of perdus) lignes.push(`     ${p}`);
    lignes.push('   Leur île garde le paquet du passage précédent pour ces points.');
  }

  // En mode vérification on ne fabrique rien : zéro île est le cas normal
  // et non une panne.
  if (verif) return { code: 0, lignes };

  if (ilesPubliees === 0) {
    lignes.push('');
    lignes.push('Aucune île n’a pu être fabriquée : rien n’est publié, le site garde');
    lignes.push('ce qui est déjà en ligne. C’est une panne, pas une publication vide.');
    return { code: 1, lignes };
  }

  return { code: 0, lignes };
}
