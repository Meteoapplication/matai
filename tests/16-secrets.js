/**
 * Une clé ne doit jamais atterrir dans un journal.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Les journaux d'exécution de GitHub Actions sont PUBLICS sur un dépôt
 * public. N'importe qui peut les ouvrir, des mois après, sans compte.
 *
 * GitHub masque bien les secrets qu'il connaît — une valeur passée par
 * `secrets.X` est remplacée par `***` si elle apparaît telle quelle. Mais
 * ce masquage se fait sur la chaîne exacte : il ne survit pas à un
 * découpage, à un encodage, à une URL qui embarque la clé en paramètre, ni
 * à une clé lue depuis un fichier plutôt que depuis `secrets`. Compter
 * dessus, c'est confier une clé à un filtre qu'on ne contrôle pas.
 *
 * ⚠️  ET LE RISQUE VIENT D'ÊTRE CRÉÉ VOLONTAIREMENT.
 *
 * Le 28 août, `build.mjs` s'est mis à écrire au début de chaque passage si
 * les clés sont arrivées — parce que « aucune clé Météo-France configurée »
 * n'apparaissait qu'au bout de la chaîne, dans le paquet publié, donc
 * seulement si la publication aboutissait. Quand elle n'aboutissait pas, on
 * pouvait poser la clé dix fois sans que le message change : il venait d'un
 * fichier écrit deux jours plus tôt.
 *
 * Ce journal-là est utile. Il est aussi le premier endroit du projet où
 * quelqu'un pourrait, en le complétant de bonne foi — « ajoutons les
 * premiers caractères pour vérifier qu'on a la bonne » — publier une clé
 * d'API sur Internet. On écrit donc sa présence et sa longueur, jamais sa
 * valeur, et ce test garde cette ligne.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

/** Les modules qui touchent à une clé. */
const SURVEILLES = ['build.mjs', 'vigilance.mjs', 'nuages.mjs', 'animation.mjs',
                    'projection.mjs', 'mesures.mjs', 'passage.mjs'];

/** Les noms de variables qui portent une clé. */
const CLES = ['OPEN_METEO_CLE', 'METEOFRANCE_CLE'];

module.exports = function () {
  const racine = path.resolve(__dirname, '..');
  const fautes = [];
  const notes = [];
  let relus = 0;

  for (const nom of SURVEILLES) {
    const chemin = path.join(racine, nom);
    if (!fs.existsSync(chemin)) continue;
    relus++;

    const source = fs.readFileSync(chemin, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    // ═════════════════════════════════════════════════════════════════
    // ⚠️  ON RELIT DES APPELS ENTIERS, PLUS DES LIGNES.
    //
    // Ce test lisait le fichier ligne par ligne et n'examinait que celles
    // qui contenaient elles-mêmes « log( ». Un appel écrit sur plusieurs
    // lignes lui échappait entièrement :
    //
    //     log(CLE
    //       ? present('OPEN_METEO_CLE', CLE) + ' — accès ' + CLE
    //       : 'absente');
    //
    // La première ligne porte « log( » mais aucune concaténation ; la
    // deuxième porte la fuite mais pas « log( », donc elle n'était même
    // pas regardée. Vérifié en sabotant exactement comme ci-dessus : zéro
    // faute relevée.
    //
    // Ce n'est pas un cas tordu — c'est la forme normale d'un message un
    // peu long, et `build.mjs` l'a prise le jour où on a voulu distinguer
    // les deux clés dans le journal. Le banc éprouvait une mise en page,
    // pas une propriété.
    //
    // On repart donc de chaque « log( » et on avance jusqu'à sa parenthèse
    // fermante, en sautant ce qui est entre guillemets, pour relire
    // l'appel COMPLET quelle que soit sa mise en page.
    // ═════════════════════════════════════════════════════════════════
    const appels = [];
    const debut = /\b(?:console\.(?:log|error|warn)|log)\s*\(/g;
    let m;
    while ((m = debut.exec(source)) !== null) {
      let i = m.index + m[0].length, profondeur = 1, guillemet = null;
      while (i < source.length && profondeur > 0) {
        const c = source[i];
        if (guillemet) {
          if (c === '\\') i++;
          else if (c === guillemet) guillemet = null;
        } else if (c === '"' || c === "'" || c === '`') {
          guillemet = c;
        } else if (c === '(') profondeur++;
        else if (c === ')') profondeur--;
        i++;
      }
      appels.push({
        texte: source.slice(m.index, i),
        ligne: source.slice(0, m.index).split('\n').length
      });
    }

    for (const a of appels) {
      // La longueur est permise, la valeur non.
      const sansLongueur = a.texte.replace(/\.length\b/g, '');
      const extrait = a.texte.replace(/\s+/g, ' ').trim().slice(0, 110);

      for (const c of CLES) {
        if (!new RegExp('\\b' + c + '\\b').test(sansLongueur)) continue;
        // `process.env.X || ''` passé à une fonction qui n'écrit que la
        // longueur est le cas légitime : on exige que l'appel ne contienne
        // pas la variable dans une concaténation de texte.
        if (/[+`]\s*\w*\s*(process\.env\.)?(OPEN_METEO_CLE|METEOFRANCE_CLE)/.test(sansLongueur)
            || /\$\{[^}]*(OPEN_METEO_CLE|METEOFRANCE_CLE)[^}]*\}/.test(sansLongueur)) {
          fautes.push(nom + ':' + a.ligne + ' — une clé est concaténée dans un '
            + 'message de journal : « ' + extrait + ' »');
        }
      }

      // La variable locale `CLE` de build.mjs porte la clé Open-Meteo.
      if (/\bCLE\b/.test(sansLongueur)
          && /[+`]\s*CLE\b|\$\{\s*CLE\s*\}/.test(sansLongueur)) {
        fautes.push(nom + ':' + a.ligne + ' — la clé Open-Meteo est écrite dans '
          + 'un message de journal : « ' + extrait + ' »');
      }
    }
  }
  notes.push(relus + ' module(s) relus, aucun ne concatène une clé dans un journal');

  // ── et l'URL qui porte la clé ne doit pas être journalisée non plus
  const build = fs.readFileSync(path.join(racine, 'build.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const ligne of build.split('\n')) {
    if (/\b(console\.(log|error)|log)\s*\(/.test(ligne)
        && /\burl(Meteo|Marine)\s*\(/.test(ligne)) {
      fautes.push('build.mjs écrit une URL construite avec la clé dans le '
        + 'journal : « ' + ligne.trim().slice(0, 90) + ' »');
    }
  }
  notes.push('aucune URL porteuse de clé n’est écrite dans le journal');

  // ── le diagnostic de présence doit exister : c'est lui qui évite de
  //    chercher une clé pendant deux jours dans un paquet périmé
  if (!/cl[ée]\s.*(pr[ée]sente|ABSENTE)/i.test(build)) {
    fautes.push('build.mjs ne dit plus au début du passage si les clés sont '
      + 'arrivées — sans ça, une clé mal posée ne se voit qu’au bout de la '
      + 'chaîne, et seulement si la publication aboutit');
  }
  notes.push('le passage annonce la présence des clés dès son début');

  return { notes, fautes };
};
