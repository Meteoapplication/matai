# Le banc du navigateur

Ce dossier contient le seul essai qui ouvre **l'application pour de vrai**.

Les neuf tests de `tests/` chargent les modules de l'app et vérifient ce
qu'ils calculent. C'est rapide, ça tourne à chaque publication, et ça attrape
beaucoup. Mais ça ne voit jamais l'écran.

Or trois défauts sur cinq de ce projet n'existaient **que** sur l'écran :

| ce qui clochait | pourquoi le banc ne pouvait pas le voir |
|---|---|
| `src/exemple.json` périmé : accueil sans température ni ciel au premier lancement | le banc nourrit l'app avec un paquet frais du backend, jamais avec l'exemple embarqué |
| « Randonnée — de 7 h à 18 h le lendemain » (35 heures) | le calcul était juste heure par heure ; c'est le regroupement, en aval, qui recollait deux journées |
| « Paddle — FAVORABLE » sans une seule heure à montrer | une plage écartée en silence ; le module ne mentait pas, la vignette si |
| la ligne de réparation du précédent, invisible le jour même | elle dépendait d'une condition vide à cette date-là |

Le dernier mérite qu'on s'y arrête. La correction avait été écrite un soir,
vérifiée le même soir, et elle était cassée à 3 h du matin — nichée dans une
condition qui s'efface quand l'éclaircie tombe le jour même, c'est-à-dire
exactement quand elle sert. Ouvrir l'app une fois, c'est essayer **une heure
sur vingt-quatre**.

D'où `horloges.js` : il ment à l'horloge du navigateur et relit les quatre
écrans à sept heures différentes de la journée.

## Les cinq essais

| fichier | ce qu'il couvre | durée |
|---|---|---|
| `horloges.js` | l'app **hors ligne**, son paquet embarqué, 7 heures × 4 écrans | ≈ 1 min |
| `iles.js` | les **neuf îles**, paquets servis depuis le disque, 4 heures × 3 écrans | ≈ 8 min |
| `etroit.js` | les **petits écrans**, 4 largeurs × 4 écrans | ≈ 1 min |
| `satellite.js` | **observé et projeté** ne se mélangent pas | ≈ 1 min |
| `abime.js` | des **paquets abîmés** servis à l'app réelle, 10 avaries × 2 heures | ≈ 4 min |

`horloges.js` ne voit qu'une île : Bora Bora, celle du paquet embarqué, et la
mieux dotée des neuf. Or c'est **ailleurs** que l'app doit se taire — Moorea et
Raiatea n'ont aucun point au large, Fakarava n'a que des passes, Tubuai n'a
qu'un point, les Marquises sont à UTC−9 h 30. Ces chemins-là ne s'affichent
jamais quand on ouvre l'app sur son bureau, et ce sont ceux où un écran vide se
lit comme une mer calme.

`iles.js` détourne donc les requêtes vers `paquets/` et redate chaque paquet
sur l'horloge simulée.

### Deux pièges dans cette redatation, tombés dans les deux

1. **Caler sur la date UTC.** Tahiti est à UTC−10 : à 18 h 30 et 22 h locales,
   la date UTC a déjà basculé. Le paquet commençait cinq heures et demie *dans
   le futur*, l'app n'avait plus d'heure pour « maintenant », et les deux
   passages du soir — qui ne testaient plus le soir — **passaient au vert**.
2. **Caler sur minuit.** Le paquet commence à 20 h. Le recaler sur minuit
   déphase la courbe de quatre heures : l'alizé ne tombe plus la nuit mais en
   fin de matinée. Or la borne du jour n'existe que *parce que* le vent tombe
   la nuit. Le jeu d'essai éteignait le défaut qu'il traquait.

Le décalage est donc un multiple de 24 h, et l'île porte son propre fuseau.

### Et une garde contre le pire résultat

`iles.js` compte les paquets **réellement servis**. Sans ce compteur, une
interception qui ne prend pas laisse l'app afficher son paquet embarqué —
Bora Bora — pendant que l'entête porte le nom de l'île demandée. Neuf îles
vertes et une seule regardée : le pire résultat possible, parce qu'il rassure.
La garde a été vérifiée en cassant le motif d'interception exprès ; elle
signale les deux (« l'écran ne porte pas le nom de l'île », « le paquet n'a
jamais été demandé »).

## Avant la première fois

```bash
npm install --no-save playwright
npx playwright install chromium
```

Playwright n'est **pas** une dépendance du projet, volontairement : il pèse un
navigateur entier, et `npm install` doit rester léger — la publication
automatique l'exécute vingt-quatre fois par jour. Le `--no-save` le garde hors
de `package.json`.

Si Playwright est déjà quelque part sur la machine, `PLAYWRIGHT=` et
`CHROMIUM=` le désignent sans rien installer. En son absence, les essais
affichent ces deux lignes au lieu d'une pile d'appels.

## Le lancer

Une seule commande, depuis `matai-backend/` :

```bash
node tests/navigateur/tout.js
```

Elle exporte l'application, la sert sur un port libre (avec un serveur écrit
en Node dans le fichier — ni Python ni rien à installer, ce projet se
développe sous Windows), lance les cinq essais, arrête le serveur et rend
un bilan.

```
  --sans-export     réutilise l'export précédent (gagne ≈ 90 s)
  --seul=etroit     ne lance qu'un essai
```

Les essais se lancent aussi un par un ; il leur faut alors une application
déjà servie et l'adresse dans `MATAI_URL`.

### Observé contre projeté

`satellite.js` est l'essai le plus important du dossier.

La page CIEL affiche deux choses qui se ressemblent comme deux gouttes d'eau
et qui n'ont pas la même valeur : douze photographies prises par GOES-18, et
six images que **nous fabriquons** en prolongeant le mouvement mesuré. Les
secondes ressemblent à des images satellite. Ce n'en sont pas.

Si quelqu'un prend une image calculée pour une photo du ciel et sort en
conséquence, ça ne se rattrape pas. Et la faute est silencieuse : rien ne
clignote, aucun test unitaire ne la voit, elle ne se découvre qu'en mer.

L'essai sert les deux jeux d'images à l'application réelle et vérifie :

- douze crans d'observation et six de projection dans la frise, pas un de plus ;
- qu'en s'arrêtant sur un cran projeté, l'écran écrit **PROJECTION** ;
- que l'image affichée vient bien du dossier `projection/` ;
- que sans projection publiée, aucun cran projeté n'apparaît ;
- **le piège** : un index servi à l'adresse de la projection mais qui ne se
  déclare pas comme telle doit être REFUSÉ. C'est ce qui arriverait si un
  chemin était inversé côté serveur — et l'application afficherait alors des
  images inventées sous une étiquette d'observation.

Il vérifie au passage la pause, la lecture et le zoom.

### Les paquets abîmés

`04-degrade.js` fait déjà ça — mais avec un moteur de rendu de substitution,
qui ne sait rien des mises à jour successives, des mesures de mise en page ni
de ce que React fait quand une valeur passe de `12` à `null` entre deux
rendus. `abime.js` reprend les mêmes avaries et les sert **par le réseau à
l'application réellement exportée**.

Ce qu'on craint n'est pas le plantage. C'est le **chiffre inventé** : « UV 0 »
à midi, « vent 0 nœud » sur un champ absent, « houle 0,0 m » quand l'API
marine n'a rien renvoyé. Un tiret, « inconnue », un silence : tout va. Un zéro
rassurant, non — c'est celui-là qui met quelqu'un à l'eau.

Vérifié en cassant `nb()` exprès (retourner `'0'` au lieu de `'—'`) : le banc
signale bien « vent nul inventé — 0 nœuds ».

### Les petits écrans

`etroit.js` mesure `scrollWidth` contre `clientWidth`. Il a trouvé une barre
d'onglets qui réclamait 336 px sur un écran de 320 : la page se laissait tirer
de côté et le dernier onglet sortait du cadre. Ce défaut-là ne se voit **pas**
sur une copie d'écran — la copie est prise à la largeur du cadre, donc ce qui
dépasse n'y figure pas. Il faut le mesurer.

320 px n'est pas une hypothèse d'école : c'est le plancher Android, et la
Polynésie n'achète pas que des téléphones neufs.

Réglages par variables d'environnement, tous facultatifs :

| variable | défaut | à quoi ça sert |
|---|---|---|
| `MATAI_URL` | `http://localhost:8099/` | où l'app est servie |
| `PLAYWRIGHT` | `playwright` | chemin du module, s'il n'est pas résoluble |
| `CHROMIUM` | *(celui de Playwright)* | un Chromium déjà installé |
| `MATAI_PAQUETS` | `../../paquets` | où `iles.js` prend les paquets |

## Ce qu'il refuse

- un `undefined`, `null`, `NaN`, `Invalid Date` ou `[object Object]` à l'écran ;
- une valeur vide là où un chiffre est annoncé (« — nœuds », « de — ») ;
- un créneau de plus de 16 heures — il enjamberait la nuit ;
- **un verdict favorable qui ne porte aucune heure.** C'est la règle de fond
  de cette application : ce qu'on écarte, on le dit. Une vignette qui annonce
  « c'est bon » sans dire quand n'aide personne à décider.

## Pourquoi il n'est pas dans `npm test`

Il lui faut un export web, un serveur et un navigateur — une minute et demie,
et tout `node_modules` de l'app. Ça n'a pas sa place à chaque publication.

Il se lance **à la main, avant une publication, dès qu'on a touché à
l'affichage.** Si vous avez modifié un fichier de `src/ecrans/` ou de
`src/composants/`, les neuf tests verts ne suffisent pas : ils n'ont pas
regardé l'écran.
