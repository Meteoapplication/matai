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

function urlMeteo(s) {
  const p = new URLSearchParams({
    latitude: s.lat, longitude: s.lon,
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation',
    wind_speed_unit: 'kn', timezone: FUSEAU, forecast_days: '3'
  });
  if (CLE) p.set('apikey', CLE);
  return `https://${HOTE_METEO}/v1/forecast?${p}`;
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
  const temps = [], vent = [], raf = [], dir = [], houle = [], per = [], hdir = [], swell = [];
  for (let i = 0; i < HEURES + 12; i++) {
    const d = new Date(t0.getTime() + i * 3600000);
    temps.push(d.toISOString().slice(0, 16));
    const cycle = Math.sin((i / 24) * Math.PI * 2);
    vent.push(arrondir(16 + cycle * 7 + (s.lat % 1) * 3, 1));
    raf.push(arrondir(22 + cycle * 9, 1));
    dir.push(135);
    houle.push(arrondir(1.6 + cycle * 0.9, 2));
    per.push(arrondir(11 + cycle * 2, 1));
    hdir.push(200);
    swell.push(arrondir(1.3 + cycle * 0.7, 2));
  }
  return {
    meteo:  { hourly: { time: temps, wind_speed_10m: vent, wind_gusts_10m: raf, wind_direction_10m: dir } },
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
      recuperer(urlMeteo(spot)),
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

    const expire = spots[0]?.heures?.slice(-1)[0]?.t || null;
    const paquet = {
      version: 1, genere, expire,
      ile: ile.id, nom: ile.nom, archipel: ile.archipel, arome: ile.arome,
      source: 'Open-Meteo — modèles ECMWF IFS et MFWAM (Météo-France)',
      avertissement: 'Prévision indicative. Ne remplace pas les bulletins de Météo-France Polynésie ni une carte marine officielle.',
      spots
    };

    await mkdir(SORTIE, { recursive: true });
    const chemin = join(SORTIE, `${ile.id}.json`);
    await writeFile(chemin, JSON.stringify(paquet), 'utf8');
    const ko = (JSON.stringify(paquet).length / 1024).toFixed(1);
    log(`  → paquets/${ile.id}.json (${ko} Ko)`);
  }

  if (!VERIF) {
    const manifeste = {
      version: 1, genere,
      iles: registre.iles.map((i) => ({
        id: i.id, nom: i.nom, archipel: i.archipel,
        arome: i.arome, fichier: `${i.id}.json`
      }))
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
