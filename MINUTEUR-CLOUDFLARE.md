# Un minuteur fiable, hors de GitHub

**À faire par Gabin.** Je ne crée pas de compte et je ne manipule pas de
jeton — c'est une limite que je garde même avec ton autorisation, parce
qu'un jeton créé par quelqu'un d'autre que toi est un jeton dont tu ne sais
pas qui l'a vu.

Compte quinze minutes. Tout est gratuit.

---

## Pourquoi

Le planificateur de GitHub n'honore qu'un passage programmé sur quatre, avec
des trous mesurés jusqu'à **32 h 53**. Ce n'est pas réglable : quatre
créneaux par heure au lieu d'un ont donné **zéro déclenchement sur soixante**
(mesuré le 28 août). Le remède est un minuteur qui ne dépend pas de GitHub et
qui vient frapper à sa porte.

Cloudflare Workers déclenche une tâche par minute, gratuitement, avec une
fiabilité qui n'a rien à voir.

---

## Étape 1 — Le jeton GitHub

1. github.com → ta photo en haut à droite → **Settings**
2. Tout en bas à gauche → **Developer settings**
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
4. Remplis :
   - **Token name** : `minuteur-matai`
   - **Expiration** : 1 an (note la date quelque part, il faudra le refaire)
   - **Repository access** : *Only select repositories* → `Meteoapplication/matai`
   - **Permissions** → *Repository permissions* → cherche **Actions** →
     passe-le sur **Read and write**
5. **Generate token**

⚠️ Le jeton ne s'affiche **qu'une fois**. Copie-le tout de suite avec
`Ctrl+A` **à l'intérieur du champ** — c'est exactement le piège qui t'avait
fait coller 168 caractères sur 1546 pour la clé Météo-France.

Ce jeton donne le droit de lancer des actions sur ce dépôt, rien d'autre. Il
ne peut ni lire ton code privé, ni toucher à tes autres dépôts.

---

## Étape 2 — Le Worker

1. dash.cloudflare.com → crée un compte si tu n'en as pas (gratuit)
2. Menu de gauche → **Workers & Pages** → **Create** → **Create Worker**
3. Nom : `minuteur-matai` → **Deploy**
4. **Edit code** → efface tout → colle ceci :

```js
export default {
  async scheduled(evenement, env, contexte) {
    const r = await fetch(
      'https://api.github.com/repos/Meteoapplication/matai/actions/workflows/matai.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.JETON_GITHUB,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'minuteur-matai'
        },
        body: JSON.stringify({ ref: 'main' })
      }
    );
    // 204 = accepté. Tout le reste part dans les journaux du Worker.
    if (r.status !== 204) {
      console.log('GitHub a refusé : ' + r.status + ' ' + (await r.text()));
    }
  }
};
```

5. **Deploy**

---

## Étape 3 — Le jeton dans le Worker

1. Sur la page du Worker → **Settings** → **Variables and Secrets**
2. **Add** → type **Secret**
3. Nom : `JETON_GITHUB` (exactement, majuscules comprises)
4. Valeur : le jeton de l'étape 1
5. **Deploy**

Le nom doit être exactement `JETON_GITHUB` : c'est ce que le code lit dans
`env.JETON_GITHUB`.

---

## Étape 4 — L'horaire

1. Sur la page du Worker → **Settings** → **Trigger Events** → **Add** →
   **Cron Trigger**
2. Expression : `*/20 * * * *` — toutes les vingt minutes
3. **Add**

Vingt minutes, c'est le rythme que tu voulais au départ. Le satellite publie
une image toutes les dix minutes ; viser vingt laisse de la marge sans
pilonner la NOAA.

---

## Vérifier que ça marche

Attends vingt minutes, puis :

**github.com/Meteoapplication/matai/actions** — un nouveau passage doit
apparaître, marqué `workflow_dispatch` et non `Scheduled`. C'est normal : du
point de vue de GitHub, c'est le Worker qui appuie sur le bouton.

Si rien n'arrive, les journaux du Worker le disent : page du Worker →
**Logs** → **Begin log stream**. Le code écrit le code d'erreur exact que
GitHub renvoie.

Les deux erreurs courantes :

| code | ce que ça veut dire |
|------|---------------------|
| 401 | le jeton est faux, ou tronqué à la copie |
| 403 | le jeton n'a pas la permission **Actions : Read and write** |
| 404 | le nom du dépôt ou du fichier de flux est mal orthographié |

---

## Après

Une fois que ça tourne, le créneau `0 * * * *` du fichier
`.github/workflows/matai.yml` devient un filet de sécurité : il se
déclenchera une fois sur quatre, et ce sera sans importance puisque le
Worker, lui, ne rate pas. Ne le retire pas — il coûte zéro et couvre le jour
où le jeton expirera.

**Note la date d'expiration du jeton dans ton agenda.** Le jour où il
expirera, le site s'arrêtera de se mettre à jour, le flux restera vert, et
rien ne préviendra. C'est exactement la panne silencieuse que ce projet
passe son temps à traquer.
