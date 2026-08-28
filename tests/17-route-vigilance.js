/**
 * Un accent, et l'alerte de sécurité ne s'affiche jamais.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Le chemin de l'API de vigilance polynésienne était écrit sans accent :
 *
 *     /DPVigilance/v1/polynesie/cartevigilance/encours
 *
 * d'après les documents envoyés par Météo-France. Le 28 août, la page de
 * l'API sur leur portail l'affiche autrement :
 *
 *     OBTENIR  /polynésie /cartevigilance /encours
 *
 * Une lettre. Si c'est la graphie accentuée qui est la bonne, l'appel
 * répond 404, la vigilance reste grise sur tous les écrans AVEC une clé
 * valide, et le message dit « le portail a répondu HTTP 404 » — exact, et
 * trompeur : on chercherait la faute du côté de la clé qu'on vient de
 * poser, pas du côté d'un accent dans une URL.
 *
 * Impossible de trancher sans clé. Deviner serait exactement ce que
 * `vigilance.mjs` s'interdit partout ailleurs. Les deux graphies sont donc
 * essayées, et ce test garde les quatre situations possibles.
 *
 * ⚠️  ET 404 EST LE SEUL CODE QUI FAIT ESSAYER L'AUTRE ADRESSE.
 *
 * Un 401 porte sur la clé, un 429 sur le quota, un 500 sur le service :
 * réessayer une seconde adresse n'y changerait rien et brouillerait le
 * diagnostic en affichant le résultat de la deuxième tentative au lieu de
 * la vraie cause. On s'arrête et on nomme le code reçu.
 * ═══════════════════════════════════════════════════════════════════════
 */

const path = require('path');

/** Une carte de vigilance minimale, dans la forme documentée. */
const CARTE = {
  product: {
    update_time: '2026-08-28T06:00:00Z',
    timelaps: {
      domain_ids: [
        { domain_id: 'VIGI987', max_color_id: 2, phenomenon_items: [] },
        {
          domain_id: 'VIGI987-13',
          max_color_id: 3,
          phenomenon_items: [{ phenomenon_id: 5, phenomenon_max_color_id: 3 }]
        }
      ]
    }
  }
};

const accentue = (u) => /polyn%C3%A9sie|polynésie/.test(u);

module.exports = async function () {
  const fautes = [];
  const notes = [];

  const vraiFetch = globalThis.fetch;
  const ancienneCle = process.env.METEOFRANCE_CLE;
  process.env.METEOFRANCE_CLE = 'clé-de-test';

  /** Charge une copie neuve du module, avec un `fetch` de substitution. */
  async function avec(reponse) {
    const vues = [];
    globalThis.fetch = async (url) => {
      vues.push(String(url));
      return reponse(String(url));
    };
    const V = await import(
      'file://' + path.resolve(__dirname, '..', 'vigilance.mjs') + '?' + Math.random()
    );
    const r = await V.recuperer({ id: 'bora-bora' });
    return { r, vues };
  }

  const ok = () => ({ ok: true, status: 200, json: async () => CARTE });
  const perdu = () => ({ ok: false, status: 404, json: async () => ({}) });

  try {
    // ── 1. seule la graphie accentuée existe
    let { r } = await avec((u) => (accentue(u) ? ok() : perdu()));
    if (r.etat !== 'orange') {
      fautes.push('graphie accentuée seule : état « ' + r.etat
        + ' » au lieu d’orange — le repli sur l’accent ne marche pas');
    }
    if (r.zone !== 'Îles Sous-le-Vent') {
      fautes.push('graphie accentuée seule : zone « ' + r.zone + ' »');
    }

    // ── 2. seule la graphie sans accent existe
    ({ r } = await avec((u) => (accentue(u) ? perdu() : ok())));
    if (r.etat !== 'orange') {
      fautes.push('graphie sans accent seule : état « ' + r.etat
        + ' » — l’ancienne adresse n’est plus essayée');
    }

    // ── 3. les deux répondent : une seule requête doit partir
    let vues;
    ({ r, vues } = await avec(ok));
    if (r.etat !== 'orange') fautes.push('les deux graphies répondent : état « ' + r.etat + ' »');
    if (vues.length !== 1) {
      fautes.push('les deux graphies répondent, mais ' + vues.length
        + ' requêtes sont parties : on interroge le portail deux fois pour rien');
    }

    // ── 4. aucune des deux : « inconnu », jamais « vert »
    ({ r } = await avec(perdu));
    if (r.etat !== 'inconnu') {
      fautes.push('aucune adresse ne répond : état « ' + r.etat
        + ' » au lieu d’« inconnu » — c’est la règle du gris');
    }
    if (!/404/.test(String(r.raison))) {
      fautes.push('aucune adresse ne répond : la raison ne nomme pas le 404 — « '
        + r.raison + ' »');
    }
    notes.push('4 situations d’adresse vérifiées, dont la graphie accentuée du portail');

    // ── 5. un code autre que 404 s'arrête net et nomme le code
    for (const code of [401, 403, 429, 500]) {
      const rep = () => ({ ok: false, status: code, json: async () => ({}) });
      const { r: rr, vues: vv } = await avec(rep);
      if (rr.etat !== 'inconnu') {
        fautes.push('HTTP ' + code + ' : état « ' + rr.etat + ' » au lieu d’« inconnu »');
      }
      if (!new RegExp(String(code)).test(String(rr.raison))) {
        fautes.push('HTTP ' + code + ' n’est pas nommé dans la raison — « ' + rr.raison
          + ' » : c’est pourtant le seul indice qu’aura celui qui cherche pourquoi');
      }
      if (vv.length !== 1) {
        fautes.push('HTTP ' + code + ' : ' + vv.length + ' requêtes envoyées — seul un 404 '
          + 'justifie d’essayer l’autre adresse');
      }
    }
    notes.push('401, 403, 429 et 500 s’arrêtent à la première adresse et nomment le code');

    // ── 6. le chemin qui a marché est rendu, pour trancher la question
    ({ r } = await avec((u) => (accentue(u) ? ok() : perdu())));
    if (!r.chemin || !/polyn/.test(r.chemin)) {
      fautes.push('l’adresse qui a répondu n’est pas rendue : sans elle, on ne saura '
        + 'jamais laquelle des deux graphies est la bonne');
    }
    if (/apikey|clé-de-test/.test(String(r.chemin))) {
      fautes.push('le chemin rendu contient la clé');
    }
    notes.push('l’adresse gagnante est rendue, sans la clé');
  } finally {
    globalThis.fetch = vraiFetch;
    if (ancienneCle === undefined) delete process.env.METEOFRANCE_CLE;
    else process.env.METEOFRANCE_CLE = ancienneCle;
  }

  return { notes, fautes };
};
