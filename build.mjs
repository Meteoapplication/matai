#!/usr/bin/env node
/**
 * Mata'i — fabrique les paquets de prévision.
 *
 * Ce script tourne deux fois par jour. Il interroge Open-Meteo pour chaque
 * spot, calcule les verdicts avec seuils.mjs, et écrit un fichier JSON par
 * île dans paquets/. L'application télécharge ces fichiers et n'a plus
 * besoin de réseau pendant 48 heures — c'est ce qui la rend utilisable
 * aux Tuamotu et aux Marquises.
 *
 *   node build.mjs           interroge l'API pour de vrai
 *   node build.mjs --demo    fabrique des données factices, sans réseau
 *   node build.mjs --verif   vérifie seulement que chaque point renvoie
 *                            une houle exploitable, et n'écrit rien
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyser } from './seuils.mjs';
import { recuperer as recupererVigilance, inconnu as vigilanceInconnue } from './vigilance.mjs';
import { produire as produireNuages, versPixel } from './nuages.mjs';
import { produireAnimation } from './animation.mjs';
import { produireProjection } from './projection.mjs';
import { recuperer as recupererMesures, pourIle as mesurePourIle } from './mesures.mjs';
import { verdictDePassage } from './passage.mjs';
import { lireJournal, ecrireJournal, dater } from './fraicheur.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, 'paquets');

const ARGS = new Set(process.argv.slice(2));
const DEMO = ARGS.has('--demo');
const VERIF = ARGS.has('--verif');

const HEURES = 48;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  LA POLYNÉSIE A TROIS FUSEAUX, ET ON EN DEMANDAIT UN SEUL.
 *
 *   Société, Tuamotu, Australes .... UTC−10
 *   Marquises ...................... UTC−9 h 30
 *   Gambier ........................ UTC−9
 *
 * Toutes les requêtes partaient en `timezone=Pacific/Tahiti`. Les heures
 * des paquets de Nuku Hiva et des Gambier étaient donc de l'heure de
 * Tahiti, pas de l'heure locale : trente minutes d'écart aux Marquises,
 * une heure pleine aux Gambier. Un pêcheur de Rikitea lisait « de 7 h à
 * 15 h » pour ce qui est, à sa montre, 8 h à 16 h.
 *
 * Pire aux Marquises : l'application, elle, calculait déjà les levers de
 * soleil à −9 h 30. Le même écran mélangeait donc deux bases de temps —
 * des heures de prévision en heure de Tahiti et un lever de soleil en
 * heure des Marquises.
 *
 * `timezone=auto` fait résoudre le fuseau par l'API, à partir des
 * coordonnées du point. On n'a plus rien à deviner, et le jour où un
 * territoire change d'heure, ça suit tout seul. Le décalage renvoyé est
 * publié dans le paquet : l'application le lit au lieu de le déduire du
 * nom de l'archipel (voir src/fuseau.js).
 * ═══════════════════════════════════════════════════════════════════════
 */
const FUSEAU = 'auto';

/** Le fuseau à utiliser pour lire « maintenant » quand on n'a rien d'autre. */
const FUSEAU_DEFAUT = 'Pacific/Tahiti';

// L'offre gratuite d'Open-Meteo interdit l'usage commercial. Avant le
// lancement, prendre l'abonnement et poser la clé dans cette variable
// d'environnement : le script bascule alors sur l'endpoint client.
const CLE = process.env.OPEN_METEO_CLE || '';
const HOTE_METEO  = CLE ? 'customer-api.open-meteo.com' : 'api.open-meteo.com';
const HOTE_MARINE = CLE ? 'customer-marine-api.open-meteo.com' : 'marine-api.open-meteo.com';

// ---------------------------------------------------------------- outils

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));

function arrondir(v, dec = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return Math.round(v * 10 ** dec) / 10 ** dec;
}

function log(...a) { console.log(...a); }

/** Récupère une URL avec quelques tentatives : le réseau polynésien coupe. */
async function recuperer(url, essais = 3) {
  let derniere;
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.reason || `HTTP ${r.status}`);
      return j;
    } catch (e) {
      derniere = e;
      if (i < essais - 1) await dodo(1500 * (i + 1));
    }
  }
  throw derniere;
}

// ---------------------------------------------------------------- réseau

/**
 * Les champs horaires demandés à Open-Meteo.
 *
 * INDISPENSABLE : sans le vent, il n'y a pas de bulletin du tout.
 * BONUS : agréable à avoir, mais jamais au prix du reste.
 *
 * Ce partage n'est pas de la cosmétique. Une API change ses noms de champs
 * sans prévenir, et un champ inconnu fait échouer la requête ENTIÈRE : en
 * ajoutant `uv_index` sans filet, on prenait le risque qu'un renommage
 * chez eux fasse tomber les vingt-et-un points de mesure d'un coup, un
 * matin, sans que personne l'ait touché. Le bulletin de sécurité ne tombe
 * pas parce qu'on voulait afficher l'indice UV.
 */
const CHAMPS_INDISPENSABLES = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];
// uv_index tient compte des nuages ; uv_index_clear_sky donne ce que le
// même ciel donnerait dégagé. L'écart entre les deux est l'information la
// plus utile de la journée : « 3 maintenant, 8 dès que ça s'ouvre » est ce
// qui brûle les gens qui ont jugé sur le gris du matin.
// temperature_2m et weather_code servent l'écran d'accueil : la
// température qu'il fait, et le pictogramme du ciel. Ce sont les deux
// premières choses que cherche quelqu'un qui ouvre une app météo, et
// elles n'étaient nulle part dans les paquets.
const CHAMPS_BONUS = ['precipitation', 'uv_index', 'uv_index_clear_sky',
                      'temperature_2m', 'weather_code'];

function urlMeteo(s, champs) {
  const p = new URLSearchParams({
    latitude: s.lat, longitude: s.lon,
    hourly: champs.join(','),
    wind_speed_unit: 'kn', timezone: FUSEAU, forecast_days: '5'
  });
  if (CLE) p.set('apikey', CLE);
  return `https://${HOTE_METEO}/v1/forecast?${p}`;
}

/**
 * Demande tout ; si ça échoue, redemande le strict nécessaire.
 * Les champs bonus manquants deviennent alors null, et l'application se
 * tait sur ces lignes-là — elle n'invente rien.
 */
let bonusAbandonnes = false;

async function recupererMeteo(s) {
  if (!bonusAbandonnes) {
    try {
      // UNE SEULE tentative pour la requête complète. Si le champ n'existe
      // plus, réessayer trois fois ne le fera pas réapparaître : ça ne fait
      // que tripler la charge sur une API dont on est l'invité.
      return await recuperer(urlMeteo(s, [...CHAMPS_INDISPENSABLES, ...CHAMPS_BONUS]), 1);
    } catch (e) {
      // Et on ne redemande pas pour les vingt spots suivants : le refus
      // porte sur le champ, pas sur le lieu. Sans ce drapeau, un renommage
      // chez Open-Meteo nous faisait envoyer soixante-trois requêtes vouées
      // à l'échec à chaque exécution horaire — mesuré, pas supposé.
      bonusAbandonnes = true;
      log(`  ! champs optionnels refusés (${e.message || e})`);
      log('    → repli sur le vent seul pour tous les points ; pluie et UV seront absents');
    }
  }
  return recuperer(urlMeteo(s, CHAMPS_INDISPENSABLES));
}

function urlMarine(s) {
  const p = new URLSearchParams({
    latitude: s.lat, longitude: s.lon,
    hourly: 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction',
    timezone: FUSEAU, forecast_days: '5'
  });
  if (CLE) p.set('apikey', CLE);
  return `https://${HOTE_MARINE}/v1/marine?${p}`;
}

/** Données factices, pour tester la chaîne sans réseau ni quota. */
/**
 * Le décalage horaire d'un point, en mode démo.
 *
 * ⚠️  LA FORME COMPTE AUTANT QUE LA VALEUR.
 *
 * L'API réelle renvoie `utc_offset_seconds` et `timezone` ; le jeu de démo
 * ne les fabriquait pas. Les paquets de démonstration sortaient donc avec
 * `decalage: null` — c'est-à-dire exactement l'état qu'on veut détecter
 * quand l'API change de forme. Un banc d'essai nourri d'une donnée plus
 * pauvre que le réel ne teste pas le réel.
 *
 * On reproduit ici les trois fuseaux polynésiens d'après la position :
 * les Marquises sont au nord (au-dessus de 12° S) et les Gambier à l'est
 * (au-delà de 138° O).
 */
function fuseauDemo(s) {
  if (s.lon > -138) return { sec: -9 * 3600, nom: 'Pacific/Gambier' };
  if (s.lat > -12) return { sec: -9.5 * 3600, nom: 'Pacific/Marquesas' };
  return { sec: -10 * 3600, nom: 'Pacific/Tahiti' };
}

function fausseReponse(s) {
  // ═══════════════════════════════════════════════════════════════════════
  // L'horloge du mode démo était l'horloge UTC.
  //
  // Le commentaire plus bas dit que « l'horodatage écrit dans `temps` fait
  // office d'heure locale, comme l'API réelle avec timezone=Pacific/Tahiti ».
  // C'était l'intention ; le code écrivait des heures UTC. Un paquet de démo
  // fabriqué à 9 h 47 à Bora Bora commençait donc à 19 h 00, et TOUT ce qui
  // s'appuie dessus — `depuisMaintenant`, les créneaux, l'UV, le crépuscule —
  // travaillait dix heures dans le futur.
  //
  // Le banc d'essai mentait donc exactement là où il devait servir de
  // référence : jamais l'heure courante à l'écran, jamais un midi solaire au
  // milieu de la liste. Corrigé ici plutôt que dans l'app : c'est la donnée
  // de test qui était fausse, pas le lecteur.
  //
  // Tahiti est à −10 h toute l'année, sans heure d'été : décaler la date puis
  // lire ses champs UTC donne l'heure murale locale, ce que le reste de la
  // fonction suppose déjà (`d.getUTCHours()` plus bas).
  // ═══════════════════════════════════════════════════════════════════════
  const DECALAGE = -10 * 3600000;
  const t0 = new Date(Math.floor((Date.now() + DECALAGE) / 3600000) * 3600000);
  const temps = [], vent = [], raf = [], dir = [], houle = [], per = [], hdir = [],
        swell = [], swellPer = [], swellDir = [],
        pluie = [], uv = [], uvClair = [], temp = [], ciel = [];

  // ⚠️  CINQ JOURS, comme l'API réelle depuis que le tableau des cinq jours
  // existe. Le jeu de démo en produisait 60 heures : le tableau n'affichait
  // donc que deux jours et demi en démo, et TROIS jours vides — un défaut
  // d'affichage qu'aucun banc n'aurait pu distinguer d'un vrai manque de
  // données. Une donnée de test plus courte que le réel ne teste pas le réel.
  const HEURES_DEMO = 24 * 5;
  for (let i = 0; i < HEURES_DEMO; i++) {
    const d = new Date(t0.getTime() + i * 3600000);
    temps.push(d.toISOString().slice(0, 16));

    // UV factice mais de forme juste : nul la nuit, cloche autour du midi
    // solaire. Sert à voir la mise en page dans le bon ordre de grandeur.
    // L'heure du paquet, pas celle du fuseau : en mode démo l'horodatage
    // écrit dans `temps` fait office d'heure locale, comme le renvoie
    // l'API réelle avec timezone=Pacific/Tahiti.
    const hLoc = d.getUTCHours();
    // Période 24 h, pas 12 : posée à 12, la courbe repartait à midi et
    // culminait à minuit. Repéré en imprimant la courbe plutôt qu'en la
    // relisant — une donnée de test à la mauvaise forme cache exactement
    // le genre de bug d'affichage qu'elle devrait révéler.
    const arche = Math.cos(((hLoc - 12.5) / 24) * Math.PI * 2);
    // Ciel clair : la cloche pleine. Réel : la même, rabotée par les
    // nuages. La pointe de 8 est celle mesurée fin août à Bora Bora, pas
    // un chiffre d'été austral — une donnée de test à la mauvaise saison
    // fait valider des affichages qu'on ne verra jamais.
    const clair = Math.max(0, 8 * (arche > 0 ? arche : 0));
    uvClair.push(arrondir(clair, 1));
    uv.push(arrondir(clair * (i % 7 === 0 ? 0.35 : 0.9), 1));

    // ═══════════════════════════════════════════════════════════════════════
    // Le vent était calé sur `i` — la position dans le tableau — et non sur
    // l'heure. Sa journée commençait donc à l'heure où le paquet avait été
    // fabriqué : à 16 h, le maximum de vent tombait à 4 h du matin, et l'écran
    // annonçait sérieusement « demain de 4 h à 17 h » pour de la plongée en
    // lagon. Une fenêtre invraisemblable dans le jeu de test, c'est un défaut
    // d'affichage qu'on ne saura plus distinguer d'un vrai.
    //
    // L'alizé force l'après-midi et tombe avant l'aube : même forme que la
    // température juste en dessous, maximum à 14 h.
    // ═══════════════════════════════════════════════════════════════════════
    const cycle = Math.cos(((hLoc - 14) / 24) * Math.PI * 2);
    vent.push(arrondir(16 + cycle * 7 + (s.lat % 1) * 3, 1));
    raf.push(arrondir(22 + cycle * 9, 1));
    dir.push(135);

    // La houle, elle, n'a pas de rythme journalier : elle vient d'une
    // dépression à mille milles et évolue sur plusieurs jours. Lui donner le
    // cycle du soleil produisait des créneaux de passe qui s'ouvraient et se
    // fermaient chaque matin — un artefact que rien dans la nature ne fait.
    const houleLente = Math.sin((i / 37) * Math.PI * 2);
    houle.push(arrondir(1.6 + houleLente * 0.9, 2));
    per.push(arrondir(11 + houleLente * 2, 1));
    hdir.push(200);
    swell.push(arrondir(1.3 + houleLente * 0.7, 2));
    // La houle longue vient de plus loin et tourne moins que la mer du
    // vent : période plus longue, direction plus stable. Sans ces deux
    // champs, le tableau des cinq jours affichait des tirets là où l'API
    // réelle donne des chiffres — et on l'aurait pris pour une panne.
    swellPer.push(arrondir(13 + houleLente * 2.5, 1));
    swellDir.push(195 + Math.round(houleLente * 10));
    // ═══════════════════════════════════════════════════════════════════════
    // Le ciel de démo passait de « ciel clair » à « orage » toutes les heures :
    // `[0,1,2,3,80,61,95][i % 7]`. Aucune journée ne fait ça. Et comme le
    // résumé d'une journée retient le PIRE code — choix voulu, pour la
    // sécurité — chaque jour du jeu de test finissait en orage tandis que
    // l'heure courante affichait un grand soleil. On lisait à l'écran « Ciel
    // clair ☀ 27° » au-dessus de trois vignettes d'orage, et impossible de
    // savoir si le défaut était dans l'app ou dans la donnée.
    //
    // Ici : une journée de saison sèche polynésienne. Clair le matin, cumulus
    // qui montent avec la chaleur, une averse de convection en milieu
    // d'après-midi un jour sur deux, et le ciel qui se dégage le soir.
    // ═══════════════════════════════════════════════════════════════════════
    const jourDeSuite = Math.floor((i + t0.getUTCHours()) / 24);
    const averseAujourdhui = jourDeSuite % 2 === 0;
    let code;
    if (hLoc < 8) code = 0;                                    // ciel clair
    else if (hLoc < 11) code = 1;                              // peu nuageux
    else if (hLoc < 14) code = 2;                              // partiellement couvert
    else if (hLoc < 17) code = averseAujourdhui ? 80 : 2;      // averse ou éclaircies
    else if (hLoc < 20) code = 1;
    else code = 0;
    ciel.push(code);
    pluie.push(code === 80 ? 2.4 : 0);
    // Température : cloche du jour autour de 27 °C, nuit vers 24 °C.
    temp.push(arrondir(25.5 + 2 * Math.cos(((hLoc - 14) / 24) * Math.PI * 2), 1));
  }
  const fus = fuseauDemo(s);
  return {
    // ⚠️  Ces deux champs sont DANS la réponse météo, pas à côté.
    //
    // L'API les renvoie à la racine de sa réponse `/v1/forecast`, c'est-à-dire
    // dans ce que le code appelle `meteo`. Posés au niveau au-dessus — mon
    // premier jet — ils étaient invisibles pour `meteo.utc_offset_seconds`,
    // et le décalage restait nul en démo alors qu'il était bien fabriqué.
    // Un faux qui n'a pas la forme du vrai ne prouve rien.
    meteo:  { utc_offset_seconds: fus.sec, timezone: fus.nom, hourly: { time: temps, wind_speed_10m: vent, wind_gusts_10m: raf, wind_direction_10m: dir, precipitation: pluie, uv_index: uv, uv_index_clear_sky: uvClair, temperature_2m: temp, weather_code: ciel } },
    marine: { hourly: {
      time: temps, wave_height: houle, wave_period: per, wave_direction: hdir,
      swell_wave_height: swell, swell_wave_period: swellPer, swell_wave_direction: swellDir
    } }
  };
}

// ------------------------------------------------------------ assemblage

async function traiterSpot(spot) {
  let meteo, marine;

  if (DEMO) {
    ({ meteo, marine } = fausseReponse(spot));
  } else {
    [meteo, marine] = await Promise.all([
      recupererMeteo(spot),
      recuperer(urlMarine(spot)).catch((e) => ({ __erreur: String(e.message || e) }))
    ]);
  }

  const erreurMarine = marine?.__erreur || null;
  const temps = meteo.hourly.time;

  // index de la marine par horodatage, pour ne pas supposer l'alignement
  const idx = {};
  if (!erreurMarine && marine?.hourly?.time) {
    marine.hourly.time.forEach((t, k) => { idx[t] = k; });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // « MAINTENANT », DANS LE FUSEAU DE CE POINT-LÀ.
  //
  // ⚠️  On ne peut PLUS passer FUSEAU à Intl.DateTimeFormat : il vaut
  // désormais 'auto', qui est une instruction pour Open-Meteo et pas un
  // fuseau IANA. `Intl` lèverait une RangeError sur le premier spot.
  //
  // L'API renvoie `utc_offset_seconds` : c'est le décalage RÉEL du point,
  // celui-là même qu'elle a utilisé pour dater les heures. On s'en sert,
  // et les deux ne peuvent donc pas diverger.
  //
  // Repli sur Tahiti si le champ manque — une API qui change de forme ne
  // doit pas faire échouer la publication.
  // ═══════════════════════════════════════════════════════════════════════
  const decalageSec = typeof meteo.utc_offset_seconds === 'number'
    ? meteo.utc_offset_seconds
    : null;

  const maintenant = decalageSec !== null
    ? new Date(Date.now() + decalageSec * 1000).toISOString().slice(0, 16)
    : new Intl.DateTimeFormat('sv-SE', {
      timeZone: FUSEAU_DEFAUT, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', hour12: false
    }).format(new Date()).replace(' ', 'T');

  let i0 = temps.findIndex((t) => t.slice(0, 13) >= maintenant.slice(0, 13));
  if (i0 < 0) i0 = 0;

  /** Une heure du paquet, à partir de son rang dans les tableaux de l'API. */
  const fabriquerHeure = (i) => {
    const t = temps[i];
    const k = idx[t];
    const M = marine?.hourly;
    return {
      t,
      vent:    arrondir(meteo.hourly.wind_speed_10m[i], 1),
      rafale:  arrondir(meteo.hourly.wind_gusts_10m?.[i], 0),
      dir:     arrondir(meteo.hourly.wind_direction_10m[i], 0),
      // La pluie était déjà demandée à l'API mais jetée. Pour un pêcheur
      // elle ne change rien ; pour un touriste qui choisit sa journée et
      // pour un prestataire de plein air, c'est la première question.
      pluie:   arrondir(meteo.hourly.precipitation?.[i], 1),
      // Si le champ manque — modèle sans UV, API changée — on publie null.
      // L'application se tait alors, elle n'affiche pas « 0 » : un zéro
      // d'index UV à midi serait un mensonge dangereux.
      uv:      arrondir(meteo.hourly.uv_index?.[i], 1),
      uvClair: arrondir(meteo.hourly.uv_index_clear_sky?.[i], 1),
      temp:    arrondir(meteo.hourly.temperature_2m?.[i], 1),
      // Code OMM du temps sensible : 0 = ciel clair, 61 = pluie, 95 = orage…
      // On publie le nombre brut, l'application le met en mots et en image.
      ciel:    meteo.hourly.weather_code?.[i] ?? null,
      houle:   k === undefined ? null : arrondir(M.wave_height?.[k], 2),
      periode: k === undefined ? null : arrondir(M.wave_period?.[k], 1),
      houleDir:k === undefined ? null : arrondir(M.wave_direction?.[k], 0),

      // ═══════════════════════════════════════════════════════════════
      // ⚠️  LA HOULE N'EST PAS LA VAGUE, ET LE CHAMP `houle` CI-DESSUS
      // PORTE LA VAGUE.
      //
      // `wave_height` est la mer TOTALE : la houle longue venue du large
      // PLUS le clapot levé par le vent local. `swell_wave_height` est la
      // houle seule. Les jours de mara'amu établi, l'écart dépasse le
      // tiers — et c'est la houle longue, pas le clapot, qui déferle sur
      // les passes et les récifs.
      //
      // Les seuils de l'application ont été calibrés sur `wave_height` :
      // on ne le change donc pas sous leurs pieds. Mais la houle vraie
      // est désormais publiée avec SA période et SA direction, et c'est
      // elle que le tableau des cinq jours affiche, comme demandé.
      //
      // L'API renvoyait déjà les trois champs : `swell_wave_period` et
      // `swell_wave_direction` étaient demandés dans l'URL puis jetés.
      // ═══════════════════════════════════════════════════════════════
      swell:    k === undefined ? null : arrondir(M.swell_wave_height?.[k], 2),
      swellPer: k === undefined ? null : arrondir(M.swell_wave_period?.[k], 1),
      swellDir: k === undefined ? null : arrondir(M.swell_wave_direction?.[k], 0)
    };
  };

  const heures = [];
  for (let i = i0; i < Math.min(i0 + HEURES, temps.length); i++) {
    heures.push(fabriquerHeure(i));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LES TRANCHES DE TROIS HEURES, SUR CINQ JOURS.
  //
  // Le tableau des cinq jours ne montre que huit colonnes par jour : 2, 5,
  // 8, 11, 14, 17, 20 et 23 heures. Publier cinq jours d'heures COMPLÈTES
  // pour les servir ferait passer le paquet de Bora Bora de 35 à près de
  // 90 kilo-octets — sur un forfait polynésien ou une connexion d'atoll,
  // pour afficher une valeur sur trois.
  //
  // On garde donc les 48 heures pleines (tout le reste de l'application en
  // vit) et on ajoute ces quarante points-là, qui coûtent trois kilo-octets.
  //
  // ⚠️  La valeur d'une tranche est celle de L'HEURE NOMMÉE, pas la moyenne
  // des trois heures autour. Une moyenne lisserait exactement le grain de
  // 14 h que la colonne existe pour montrer.
  // ═══════════════════════════════════════════════════════════════════════
  const TRANCHES = [2, 5, 8, 11, 14, 17, 20, 23];
  const tranches = [];
  for (let i = 0; i < temps.length; i++) {
    const hh = parseInt(String(temps[i]).slice(11, 13), 10);
    if (!TRANCHES.includes(hh)) continue;
    if (temps[i] < temps[i0].slice(0, 10)) continue;   // rien d'avant aujourd'hui

    // ⚠️  On ne recopie PAS les quatorze champs d'une heure.
    //
    // Le tableau affiche cinq lignes : ciel, pluie, vent, houle, et l'heure.
    // Emporter en plus l'index UV, la température, les rafales et la mer du
    // vent — que ce tableau n'affiche jamais — a fait passer le paquet de
    // Bora Bora de 35 à 57 kilo-octets pour rien. Sur un forfait polynésien,
    // « pour rien » se paie.
    const h = fabriquerHeure(i);
    tranches.push({
      t: h.t,
      ciel: h.ciel,
      pluie: h.pluie,
      vent: h.vent,
      dir: h.dir,
      // La houle LONGUE, avec sa période et sa direction : c'est elle qui
      // est demandée dans ce tableau, pas la mer totale. Voir le bloc sur
      // `swell` plus haut.
      houle: h.swell,
      periode: h.swellPer,
      houleDir: h.swellDir
    });
  }

  const a = analyser(heures, spot.type);

  return {
    id: spot.id,
    nom: spot.nom,
    type: spot.type,
    lat: spot.lat,
    lon: spot.lon,
    verdict: a.cat,
    ferme: a.ferme,
    ouvre: a.ouvre,
    heures: a.heures,
    tranches,
    // Le décalage horaire du point, en heures, tel que l'API l'a appliqué.
    decalage: decalageSec !== null ? decalageSec / 3600 : null,
    fuseau: meteo.timezone || null,
    erreurMarine
  };
}

/**
 * La position d'un point dans l'image régionale, en fraction (0 à 1).
 * Renvoie {} si le point n'y est pas — l'application n'affichera rien.
 */
function positionDansImage(region, point) {
  if (!region || !region.disque || !region.origine) return {};
  const p = versPixel(point.lat, point.lon, region.disque);
  if (!p) return {};
  const x = (p.col - region.origine.col) / region.largeur;
  const y = (p.lig - region.origine.lig) / region.hauteur;
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return {};
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
}

// ------------------------------------------------------------------ main

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Contrôle de précision des coordonnées.
 *
 * Les NEUF PASSES ont été relevées dans OpenStreetMap le 27 août : elles sont
 * désormais écrites à quatre décimales, sur l'objet `natural=strait` qui porte
 * leur nom. Avant, elles étaient estimées à la lecture d'une carte, et l'écart
 * allait jusqu'à ONZE KILOMÈTRES (Passe Garuae, Fakarava). Les écarts mesurés
 * sont dans tests/05-spots.js, qui refuse désormais de laisser publier une
 * passe imprécise.
 *
 * Restent dix points à deux décimales. Ce ne sont pas des oublis :
 *
 *   — six sont des positions CHOISIES et non des lieux — un DCP mouillé au
 *     large, « Lagon nord », « Au large, sud ». Aucun objet ne porte ce nom
 *     dans OpenStreetMap ; il n'y a rien à relever.
 *   — trois sont des lieux réels (Baie de Povai, Baie de Phaéton, Rikitea)
 *     dont le nœud OSM tombe à TERRE. Les y déplacer ferait perdre la houle :
 *     il faut choisir un point d'eau devant, ce qui demande de regarder une
 *     carte marine, pas d'écrire une requête.
 *   — un est un site de plongée (Tombant de Tapu) qu'OpenStreetMap ignore.
 *
 * Ce contrôle les rappelle à chaque exécution, sans bloquer : c'est une dette
 * connue, pas une régression.
 *
 * On compte les décimales TELLES QU'ÉCRITES dans le fichier, pas telles que
 * lues par JSON.parse : `-16.50` et `-16.5` sont le même nombre pour le
 * moteur, et le second n'a plus qu'une décimale une fois analysé. Compter sur
 * le nombre ferait passer une coordonnée au demi-kilomètre pour une
 * coordonnée à cinq kilomètres près. On lit donc le texte source.
 */
function decimalesEcrites(texte) {
  const par = {};
  const re = /"(lat|lon)"\s*:\s*(-?\d+(?:\.(\d+))?)/g;
  let m;
  const suite = [];
  while ((m = re.exec(texte)) !== null) suite.push(m[3] ? m[3].length : 0);
  par.suite = suite;
  return par;
}

function controlerPrecision(registre, texte) {
  // Les couples lat/lon apparaissent dans l'ordre du fichier : on les
  // apparie avec les points parcourus dans le même ordre.
  const dec = decimalesEcrites(texte).suite;
  let k = 0;
  const flous = [];

  for (const ile of registre.iles) {
    for (const sp of ile.spots || []) {
      const dLat = dec[k++];
      const dLon = dec[k++];
      const d = Math.min(
        dLat === undefined ? 9 : dLat,
        dLon === undefined ? 9 : dLon
      );
      if (d < 3) flous.push({ ile: ile.nom, nom: sp.nom, d });
    }
  }
  if (flous.length === 0) return;

  // 1 décimale ≈ 11 km, 2 ≈ 1,1 km : c'est la maille du quadrillage, donc
  // l'écart maximal est la moitié.
  const marge = (d) => (d === 0 ? '± 55 km' : d === 1 ? '± 5,5 km' : '± 550 m');

  log(`  ⚠ ${flous.length} point(s) sur ${k / 2} écrits à moins de 3 décimales — position estimée, non relevée :`);
  for (const f of flous) {
    log(`      ${f.ile} / ${f.nom} — ${f.d} décimale${f.d > 1 ? 's' : ''}, ${marge(f.d)}`);
  }
}

async function principal() {
  const brutSpots = await readFile(join(ICI, 'spots.json'), 'utf8');
  const registre = JSON.parse(brutSpots);
  const genere = new Date().toISOString();

  log(DEMO ? '— mode démo, aucune requête réseau —' : `— interrogation de ${HOTE_METEO} —`);

  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️  DIRE TOUT DE SUITE SI LES CLÉS SONT ARRIVÉES.
  //
  // « aucune clé Météo-France configurée » n'apparaissait que dans le
  // paquet publié, c'est-à-dire au bout de la chaîne — et seulement si la
  // publication aboutissait. Quand elle n'aboutissait pas, ce message
  // restait celui d'un paquet vieux de deux jours, et on pouvait poser la
  // clé, la reposer, la vérifier dix fois sans que rien ne change à
  // l'écran : le message venait d'un fichier écrit avant.
  //
  // Deux lignes de journal au début du passage suppriment toute cette
  // devinette. On n'écrit JAMAIS la clé — seulement le fait qu'elle est là
  // et sa longueur, qui suffit à repérer un collage tronqué ou des
  // guillemets pris dans le secret.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // ⚠️  ET LE MESSAGE D'ABSENCE DOIT DIRE LAQUELLE DES DEUX ABSENCES C'EST.
  //
  // Le premier jet écrivait, pour les deux clés :
  //
  //     ABSENTE — le secret du dépôt ne parvient pas au script
  //
  // C'est une accusation, et elle était fausse pour OPEN_METEO_CLE : ce
  // secret n'a jamais été créé dans le dépôt. La phrase a envoyé quelqu'un
  // chercher pendant un moment une panne de transmission qui n'existait
  // pas — alors que METEOFRANCE_CLE arrivait très bien par le même chemin,
  // ce qui prouvait justement que le chemin marchait.
  //
  // Un journal qui accuse à tort coûte plus cher qu'un journal muet. Les
  // deux clés n'ont donc plus le même message, parce qu'elles n'ont pas la
  // même conséquence :
  //
  //   · OPEN_METEO_CLE absente : les prévisions marchent quand même, sur
  //     l'offre gratuite. Ce n'est pas une panne, c'est une échéance.
  //   · METEOFRANCE_CLE absente : la vigilance ne sort plus du tout. C'est
  //     une panne, et elle mérite un cri.
  // ═══════════════════════════════════════════════════════════════════════
  if (!DEMO) {
    const present = (nom, v) => `  clé ${nom} : présente (${v.length} caractères)`;
    log(CLE
      ? present('OPEN_METEO_CLE', CLE) + ' — accès client'
      : '  clé OPEN_METEO_CLE : absente — on interroge l’offre GRATUITE '
        + 'd’Open-Meteo, qui interdit l’usage commercial. Les prévisions '
        + 'fonctionnent ; à créer dans Réglages → Secrets and variables → '
        + 'Actions avant le lancement.');

    const mf = process.env.METEOFRANCE_CLE || '';
    log(mf
      ? present('METEOFRANCE_CLE', mf)
      : '  clé METEOFRANCE_CLE : ABSENTE — la vigilance ne sera pas publiée. '
        + 'Si le secret existe pourtant dans le dépôt, c’est qu’il ne parvient '
        + 'pas au script : vérifier son nom exact et qu’il est bien un secret '
        + 'de DÉPÔT et non d’environnement.');
  }

  controlerPrecision(registre, brutSpots);

  // Les nuages : un seul téléchargement du disque satellite pour toutes les
  // îles, découpé ensuite. C'est un plus — jamais une raison de faire
  // échouer la publication des prévisions.
  let nuages = { iles: {}, region: null };
  let animation = null;
  if (!DEMO && !VERIF) {
    try {
      nuages = await produireNuages(registre.iles, SORTIE);
    } catch (e) {
      log(`  nuages : étape abandonnée — ${(e && e.message) || e}`);
    }
    // La boucle animée. Elle vit à part : l'app la lit directement à son
    // adresse fixe, sans repasser par les paquets. C'est ce qui permet de
    // rafraîchir les nuages toutes les vingt minutes sans refaire les
    // prévisions, qui, elles, ne changent que quelques fois par jour.
    try {
      animation = await produireAnimation(SORTIE);
    } catch (e) {
      log(`  animation : étape abandonnée — ${(e && e.message) || e}`);
    }

    // La projection du déplacement des nuages. Elle se nourrit des images
    // que l'animation vient de déposer, et elle écrit AILLEURS —
    // nuages/projection/, jamais nuages/anim/. Voir projection.mjs.
    try {
      const pr = await produireProjection(SORTIE);
      if (pr.erreur) {
        log(`  projection : rien publié — ${pr.erreur}`
          + (pr.canal ? ` (mesure sur ${pr.canal})` : ''));
        // ⚠️  ET LES CHIFFRES QUI ONT MOTIVÉ LE REFUS.
        //
        // Le verdict seul ne sert à rien : « mouvement incohérent » ne dit
        // ni de combien, ni sur quelle paire. Sans ces nombres, régler un
        // seuil revient à deviner, et on ne règle pas au jugé un calcul qui
        // décide de ce qu'on montre comme une prévision.
        //
        // ⚠️  ET SEULEMENT LES CHIFFRES QUI EXISTENT. Le premier jet écrivait
        // « dispersion undefined » chaque fois que le refus venait de
        // l'éclairement — la dispersion n'est calculée qu'après ce test-là.
        // Un journal qui affiche « undefined » apprend à ne plus être lu.
        const d = pr.detail;
        if (d && (d.dxs || d.dispersion !== undefined || d.eclairement !== undefined)) {
          const bouts = [];
          if (d.dxs) bouts.push(`dx ${JSON.stringify(d.dxs)}`);
          if (d.dys) bouts.push(`dy ${JSON.stringify(d.dys)}`);
          if (d.dispersion !== undefined) bouts.push(`dispersion ${d.dispersion}`);
          if (d.eclairement !== undefined) {
            bouts.push(`éclairement ${Math.round(d.eclairement * 100)} % (seuil 15 %)`);
          }
          if (d.desaccord !== undefined) {
            bouts.push(`désaccord entre tuiles ${d.desaccord} (seuil 4)`);
          }
          if (d.tuiles) {
            bouts.push('tuiles ' + d.tuiles.map((t) => `(${t.dx},${t.dy})`).join(' '));
          }
          log(`    mesures par paire : ${bouts.join(' · ')}`);
        }
      } else {
        log(`  projection : ${pr.images.length} image(s), déplacement `
          + `${pr.mouvement.dxPixels}/${pr.mouvement.dyPixels} px par pas`
          + ` (mesure sur ${pr.mouvement.canal})`);
      }
    } catch (e) {
      log(`  projection : étape abandonnée — ${(e && e.message) || e}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ⚠️  LA MESURE PAR ÎLE. ELLE NE PUBLIE RIEN — ENCORE.
    //
    // Le modèle régional est faux à son échelle : les seize tuiles de
    // l'emprise s'écartaient de trente-six kilomètres le 28 août. La même
    // méthode dans une fenêtre de mille kilomètres autour d'une île tient,
    // et c'est la question que les gens se posent : « ce grain, il arrive
    // sur moi ? »
    //
    // On MESURE et on écrit dans le journal. Rien n'est servi à
    // l'application. C'est délibéré : ce projet a déjà publié une
    // fonctionnalité dont personne n'avait regardé les chiffres en
    // production — la projection régionale, jamais sortie une seule fois
    // sans que rien ne l'annonce. On inverse l'ordre. Quelques passages
    // diront si les îles s'accordent vraiment, et lesquelles.
    //
    // Un échec ici ne doit RIEN casser : c'est une mesure d'observation.
    // ═══════════════════════════════════════════════════════════════════
    try {
      const { mesurerToutesLesIles, direMesures } = await import('./parile.mjs');
      const { default: sharpMod } = await import('sharp');
      const anim = JSON.parse(await readFile(
        join(SORTIE, 'nuages', 'anim', 'index.json'), 'utf8'));
      const noms = (anim.images || [])
        .map((x) => String(x.fichier || x.horodatage || x).split(/[\\/]/).pop())
        .map((n) => (n.endsWith('.jpg') ? n : n + '.jpg'))
        .sort();

      // On mesure sur le canal infrarouge s'il est complet, comme la
      // projection — sinon on ne mesure pas du tout : un canal à moitié
      // rempli donnerait des chiffres qu'on ne saurait pas interpréter.
      const dossierIr = join(SORTIE, 'nuages', 'anim-ir');
      const chemins = noms.map((n) => join(dossierIr, n));
      const complet = (await Promise.all(chemins.map(
        (c) => access(c).then(() => true).catch(() => false)))).every(Boolean);

      if (!complet) {
        log('  par île : pas encore assez d’images infrarouges pour mesurer');
      } else if (noms.length < 6) {
        log('  par île : trop peu d’images');
      } else {
        // `registre` est le fichier entier ; les îles sont sous `iles`, et
        // la position se prend sur le premier point de mesure de l'île —
        // une île n'a pas de latitude à sa racine.
        const iles = (registre.iles || [])
          .filter((r) => r.spots && r.spots.length)
          .map((r) => ({
            id: r.id, nom: r.nom, ...positionDansImage(nuages.region, r.spots[0])
          }))
          .filter((x) => typeof x.x === 'number');

        // ⚠️  LES DIMENSIONS SE LISENT SUR L'IMAGE, ELLES NE SE DEVINENT PAS.
        //
        // L'index de l'animation porte 1233 × 1068 : c'est le recadrage
        // VISIBLE, pris sur un disque de 5424. Les images infrarouges sont
        // prises sur un disque de 1808 et font 412 × 357. Passer les
        // dimensions de l'index aurait demandé à sharp un découpage hors
        // cadre — et le try/catch autour aurait avalé l'erreur en écrivant
        // une ligne que personne ne lit. C'est exactement la panne
        // silencieuse qui a rendu la projection régionale muette pendant
        // toute son existence.
        //
        // L'échelle se déduit du rapport : les deux recadrages couvrent la
        // même portion de globe, donc le rapport des largeurs est celui des
        // kilomètres par pixel. Si la taille de l'infrarouge change un
        // jour, ce calcul suit tout seul.
        const metaIr = await sharpMod(chemins[chemins.length - 1]).metadata();
        const kmParPixel = (anim.largeur * (anim.kilometresParPixel || 2)) / metaIr.width;

        const m = await mesurerToutesLesIles(sharpMod, chemins, iles, {
          largeur: metaIr.width, hauteur: metaIr.height,
          kmParPixel, cadence: anim.cadence || 10
        });
        const bons = m.filter((x) => !x.refus).length;
        log(`  par île : ${bons}/${m.length} île(s) mesurées (journal seulement, rien n’est publié)`);
        for (const ligne of direMesures(m)) log(ligne);
      }
    } catch (e) {
      log(`  par île : mesure abandonnée — ${(e && e.message) || e}`);
    }
  }

  // ── Les mesures réelles, une seule requête pour tout le territoire.
  //
  // Une seule station répond dans toute la Polynésie (Tahiti-Faa'a) mais on
  // interroge les neuf codes : le jour où l'une des huit autres se met à
  // publier, elle arrive sans qu'on touche à quoi que ce soit.
  let mesures = { erreur: 'mode démo', stations: [] };
  if (!DEMO && !VERIF) {
    mesures = await recupererMesures();
    log(mesures.erreur
      ? `  mesures : indisponibles — ${mesures.erreur}`
      : `  mesures : ${mesures.stations.length} station(s), `
        + mesures.stations.map((x) => x.oaci + ' ×' + x.releves.length).join(', '));
  }

  const journal = await lireJournal(SORTIE);
  const journalNeuf = {};

  let total = 0, sansHoule = 0, echecs = 0;
  // Combien d'îles ont réellement été écrites, et quels points sont tombés.
  // Le code de sortie se décide là-dessus, et sur rien d'autre. Voir le
  // bloc « UN POINT QUI TOMBE N'ARRÊTE PAS LA PUBLICATION » plus bas.
  let ilesPubliees = 0;
  const perdus = [];
  const resume = [];

  for (const ile of registre.iles) {
    const spots = [];
    const manquants = [];

    for (const spot of ile.spots) {
      total++;
      try {
        const r = await traiterSpot(spot);
        spots.push(r);

        const a = r.heures[0] || {};
        const houleOk = a.houle !== null && a.houle !== undefined;
        if (!houleOk && spot.type !== 'lagon') sansHoule++;

        resume.push({
          ile: ile.nom, spot: spot.nom, type: spot.type,
          vent: a.vent, houle: a.houle, periode: a.periode,
          verdict: r.verdict, houleOk
        });

        log(`  ${houleOk ? 'ok  ' : 'HOULE ABSENTE'} ${ile.nom} / ${spot.nom} — ${a.vent ?? '?'} nds, ${a.houle ?? '—'} m → ${r.verdict}`);
      } catch (e) {
        echecs++;
        manquants.push(spot.id);
        perdus.push(`${ile.nom} / ${spot.nom} — ${e.message || e}`);
        log(`  ÉCHEC ${ile.nom} / ${spot.nom} — ${e.message || e}`);
      }
      if (!DEMO) await dodo(250); // on ne martèle pas l'API
    }

    if (VERIF || spots.length === 0) continue;

    // La vigilance officielle. En cas de doute, elle vaut « inconnu » —
    // jamais « vert ». Voir l'en-tête de vigilance.mjs.
    let vigilance;
    try {
      vigilance = DEMO
        ? vigilanceInconnue('mode démo')
        : await recupererVigilance(ile);
    } catch (e) {
      vigilance = vigilanceInconnue(String((e && e.message) || e));
    }
    log(`  vigilance ${ile.nom} : ${vigilance.etat}${vigilance.raison ? ' (' + vigilance.raison + ')' : ''}`);

    const expire = spots[0]?.heures?.slice(-1)[0]?.t || null;

    // La station de mesure la plus proche, avec sa distance. C'est
    // l'application qui décidera si elle a le droit de l'appeler « les
    // conditions ici » — voir MESURE_PROCHE_KM dans src/provenance.js.
    const centre = {
      lat: ile.spots.reduce((a, x) => a + x.lat, 0) / (ile.spots.length || 1),
      lon: ile.spots.reduce((a, x) => a + x.lon, 0) / (ile.spots.length || 1)
    };
    const mesure = mesurePourIle(mesures, centre);

    // Le décalage horaire de l'île, remonté depuis ses points de mesure.
    // Tous les spots d'une île sont dans le même fuseau ; on prend le
    // premier qui en porte un, et on laisse `null` si aucun n'en a — dans
    // ce cas l'application retombe sur sa table par archipel.
    const decalage = spots.map((x) => x.decalage)
      .find((d) => typeof d === 'number');

    const paquet = {
      version: 2, genere, expire,
      decalage: decalage === undefined ? null : decalage,
      fuseau: (spots.find((x) => x.fuseau) || {}).fuseau || null,
      mesure,
      ile: ile.id, nom: ile.nom, archipel: ile.archipel, arome: ile.arome,
      source: 'Open-Meteo — modèles ECMWF IFS et MFWAM (Météo-France)',
      avertissement: 'Prévision indicative. Ne remplace pas les bulletins de Météo-France Polynésie ni une carte marine officielle.',
      vigilance,
      nuages: (nuages.iles && nuages.iles[ile.id]) || null,
      cielRegional: nuages.region
        ? {
          ...nuages.region,
          animation: 'nuages/anim/index.json',
          projection: 'nuages/projection/index.json',
          // ═══════════════════════════════════════════════════════════
          // OÙ TOMBE CETTE ÎLE DANS L'IMAGE, EN FRACTION DE 0 À 1.
          //
          // Sans ce couple, l'application ne peut pas poser le repère de
          // position sur la vue satellite : il faudrait qu'elle refasse
          // la projection géostationnaire de GOES-18, qui vit ici. Elle
          // poserait donc le point au jugé — c'est-à-dire une information
          // fausse, sur une image que les gens utilisent pour voir d'où
          // vient un grain.
          //
          // `null` si l'île n'est pas dans l'emprise : l'application
          // n'affiche alors aucun repère, ce qui est la bonne réponse.
          // ═══════════════════════════════════════════════════════════
          ...positionDansImage(nuages.region, centre)
        }
        : null,
      spots,
      // ⚠️  Un point qui n'a pas répondu ne disparaît pas en silence.
      //
      // Sans ce champ, une île publiée avec deux points sur trois est
      // indiscernable d'une île qui n'en a que deux : l'écran affiche ce
      // qu'il reçoit et ne peut pas savoir qu'il manque la passe. On écrit
      // donc les identifiants tombés, et seulement s'il y en a — un tableau
      // vide dans chaque paquet ne dirait rien et coûterait de la place.
      ...(manquants.length ? { manquants } : {})
    };

    // ── La date de mise à jour RÉELLE : elle ne bouge que si les
    // prévisions ont changé. Voir fraicheur.mjs.
    const d = dater(paquet, journal[ile.id], new Date());
    paquet.majReelle = d.majReelle;
    paquet.prochaine = d.prochaine;
    paquet.republications = d.republications;
    journalNeuf[ile.id] = {
      empreinte: d.empreinte,
      majReelle: d.majReelle,
      republications: d.republications
    };
    log(`  fraîcheur ${ile.nom} : ${d.change ? 'données NEUVES' : 'inchangées (' + d.republications + 'ᵉ republication)'}`);

    await mkdir(SORTIE, { recursive: true });
    const chemin = join(SORTIE, `${ile.id}.json`);
    await writeFile(chemin, JSON.stringify(paquet), 'utf8');
    const ko = (JSON.stringify(paquet).length / 1024).toFixed(1);
    ilesPubliees++;
    log(`  → paquets/${ile.id}.json (${ko} Ko)`);
  }

  if (!VERIF && Object.keys(journalNeuf).length) {
    // ⚠️  ON FUSIONNE AVEC L'ANCIEN JOURNAL, ON NE LE REMPLACE PAS.
    //
    // `journalNeuf` ne contient que les îles traitées avec succès CE
    // passage-là. Écrit tel quel, il efface l'entrée d'une île dont la
    // récupération a échoué une fois — et au passage suivant cette île
    // paraît neuve, donc l'application annonce une mise à jour qui n'a pas
    // eu lieu. Une panne réseau de trente secondes suffirait à remettre à
    // zéro la fraîcheur d'une île, exactement le mensonge que fraicheur.mjs
    // existe pour empêcher.
    //
    // Le dossier `paquets/` est restauré depuis la branche « site » au début
    // de chaque exécution (voir .github/workflows/matai.yml), donc l'ancien
    // journal est bien là pour être fusionné.
    await ecrireJournal(SORTIE, { ...journal, ...journalNeuf });
  }

  if (!VERIF) {
    // Le manifeste porte désormais un point représentatif par île — le
    // centre de ses spots. C'est ce qui permet à l'app de savoir sur quelle
    // île se trouve l'utilisateur sans rien télécharger d'autre.
    const manifeste = {
      version: 2, genere,
      iles: registre.iles.map((i) => {
        const n = i.spots.length || 1;
        return {
          id: i.id, nom: i.nom, archipel: i.archipel,
          arome: i.arome, fichier: `${i.id}.json`,
          lat: arrondir(i.spots.reduce((s, x) => s + x.lat, 0) / n, 3),
          lon: arrondir(i.spots.reduce((s, x) => s + x.lon, 0) / n, 3)
        };
      })
    };
    await writeFile(join(SORTIE, 'manifeste.json'), JSON.stringify(manifeste), 'utf8');
    log('  → paquets/manifeste.json');
  }

  log('');
  log(`${total} spots traités · ${echecs} échec(s) · ${sansHoule} sans houle exploitable`);
  if (sansHoule > 0) {
    log('Les spots sans houle ont une maille marine qui tombe sur de la terre.');
    log('Décale leurs coordonnées de quelques kilomètres vers le large dans spots.json.');
  }
  // La règle qui décide du code de sortie vit dans passage.mjs, avec son
  // histoire : elle a coûté trente heures de site figé.
  const v = verdictDePassage({ ilesPubliees, perdus, verif: VERIF });
  for (const l of v.lignes) log(l);
  if (v.code) process.exitCode = v.code;
}

principal().catch((e) => {
  console.error('Échec complet :', e);
  process.exit(1);
});
