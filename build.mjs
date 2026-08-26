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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyser } from './seuils.mjs';
import { recuperer as recupererVigilance, inconnu as vigilanceInconnue } from './vigilance.mjs';
import { produire as produireNuages } from './nuages.mjs';
import { produireAnimation } from './animation.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, 'paquets');

const ARGS = new Set(process.argv.slice(2));
const DEMO = ARGS.has('--demo');
const VERIF = ARGS.has('--verif');

const HEURES = 48;
const FUSEAU = 'Pacific/Tahiti';

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
const CHAMPS_BONUS = ['precipitation', 'uv_index'];

function urlMeteo(s, champs) {
  const p = new URLSearchParams({
    latitude: s.lat, longitude: s.lon,
    hourly: champs.join(','),
    wind_speed_unit: 'kn', timezone: FUSEAU, forecast_days: '3'
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
    timezone: FUSEAU, forecast_days: '3'
  });
  if (CLE) p.set('apikey', CLE);
  return `https://${HOTE_MARINE}/v1/marine?${p}`;
}

/** Données factices, pour tester la chaîne sans réseau ni quota. */
function fausseReponse(s) {
  const t0 = new Date();
  t0.setMinutes(0, 0, 0);
  const temps = [], vent = [], raf = [], dir = [], houle = [], per = [], hdir = [], swell = [], pluie = [], uv = [];
  for (let i = 0; i < HEURES + 12; i++) {
    const d = new Date(t0.getTime() + i * 3600000);
    temps.push(d.toISOString().slice(0, 16));
    const cycle = Math.sin((i / 24) * Math.PI * 2);

    // UV factice mais de forme juste : nul la nuit, cloche autour du midi
    // solaire, crête vers 13 — ce qui est la réalité d'ici, pas une
    // exagération. Sert à voir la mise en page dans le bon ordre de grandeur.
    // L'heure du paquet, pas celle du fuseau : en mode démo l'horodatage
    // écrit dans `temps` fait office d'heure locale, comme le renvoie
    // l'API réelle avec timezone=Pacific/Tahiti.
    const hLoc = d.getUTCHours();
    // Période 24 h, pas 12 : posée à 12, la courbe repartait à midi et
    // culminait à minuit. Repéré en imprimant la courbe plutôt qu'en la
    // relisant — une donnée de test à la mauvaise forme cache exactement
    // le genre de bug d'affichage qu'elle devrait révéler.
    const arche = Math.cos(((hLoc - 12.5) / 24) * Math.PI * 2);
    uv.push(arrondir(Math.max(0, 13 * (arche > 0 ? arche : 0)), 1));
    vent.push(arrondir(16 + cycle * 7 + (s.lat % 1) * 3, 1));
    raf.push(arrondir(22 + cycle * 9, 1));
    dir.push(135);
    houle.push(arrondir(1.6 + cycle * 0.9, 2));
    per.push(arrondir(11 + cycle * 2, 1));
    hdir.push(200);
    swell.push(arrondir(1.3 + cycle * 0.7, 2));
    pluie.push(i % 9 === 0 ? 2.4 : 0);
  }
  return {
    meteo:  { hourly: { time: temps, wind_speed_10m: vent, wind_gusts_10m: raf, wind_direction_10m: dir, precipitation: pluie, uv_index: uv } },
    marine: { hourly: { time: temps, wave_height: houle, wave_period: per, wave_direction: hdir, swell_wave_height: swell } }
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

  // on démarre à l'heure courante à Tahiti
  const maintenant = new Intl.DateTimeFormat('sv-SE', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  }).format(new Date()).replace(' ', 'T');

  let i0 = temps.findIndex((t) => t.slice(0, 13) >= maintenant.slice(0, 13));
  if (i0 < 0) i0 = 0;

  const heures = [];
  for (let i = i0; i < Math.min(i0 + HEURES, temps.length); i++) {
    const t = temps[i];
    const k = idx[t];
    const M = marine?.hourly;
    heures.push({
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
      houle:   k === undefined ? null : arrondir(M.wave_height?.[k], 2),
      periode: k === undefined ? null : arrondir(M.wave_period?.[k], 1),
      houleDir:k === undefined ? null : arrondir(M.wave_direction?.[k], 0),
      swell:   k === undefined ? null : arrondir(M.swell_wave_height?.[k], 2)
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
    erreurMarine
  };
}

// ------------------------------------------------------------------ main

async function principal() {
  const registre = JSON.parse(await readFile(join(ICI, 'spots.json'), 'utf8'));
  const genere = new Date().toISOString();

  log(DEMO ? '— mode démo, aucune requête réseau —' : `— interrogation de ${HOTE_METEO} —`);

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
  }

  let total = 0, sansHoule = 0, echecs = 0;
  const resume = [];

  for (const ile of registre.iles) {
    const spots = [];

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
    const paquet = {
      version: 2, genere, expire,
      ile: ile.id, nom: ile.nom, archipel: ile.archipel, arome: ile.arome,
      source: 'Open-Meteo — modèles ECMWF IFS et MFWAM (Météo-France)',
      avertissement: 'Prévision indicative. Ne remplace pas les bulletins de Météo-France Polynésie ni une carte marine officielle.',
      vigilance,
      nuages: (nuages.iles && nuages.iles[ile.id]) || null,
      cielRegional: nuages.region
        ? { ...nuages.region, animation: 'nuages/anim/index.json' }
        : null,
      spots
    };

    await mkdir(SORTIE, { recursive: true });
    const chemin = join(SORTIE, `${ile.id}.json`);
    await writeFile(chemin, JSON.stringify(paquet), 'utf8');
    const ko = (JSON.stringify(paquet).length / 1024).toFixed(1);
    log(`  → paquets/${ile.id}.json (${ko} Ko)`);
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
  if (echecs > 0) process.exitCode = 1;
}

principal().catch((e) => {
  console.error('Échec complet :', e);
  process.exit(1);
});
