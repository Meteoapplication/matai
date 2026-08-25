# Mata'i — le backend

Ce dossier fabrique les prévisions que l'application affichera. Il tourne
deux fois par jour, interroge Open-Meteo pour chaque spot, calcule les
verdicts, et écrit un fichier JSON par île.

L'application télécharge ces fichiers et n'a **plus besoin de réseau
pendant 48 heures**. C'est ce qui la rend utilisable aux Tuamotu et aux
Marquises — et c'est ce qu'aucun concurrent ne fait.

---

## Le tester tout de suite, sans rien installer

Ouvre un terminal dans ce dossier et lance :

```
node build.mjs --demo
```

Le mode démo fabrique des données factices, sans toucher au réseau. Ça te
permet de voir la chaîne complète tourner et de regarder à quoi ressemble
un paquet dans `paquets/`.

Pour de vraies données :

```
node build.mjs
```

Pour vérifier seulement que chaque point renvoie bien une houle, sans rien
écrire :

```
node build.mjs --verif
```

C'est cette dernière commande qui répond à la question qui reste ouverte :
est-ce que la couverture tient jusqu'aux Marquises et aux Gambier. Si un
spot ressort en « HOULE ABSENTE », c'est que sa maille marine tombe sur de
la terre — il suffit de décaler ses coordonnées de quelques kilomètres vers
le large dans `spots.json`.

---

## Les quatre fichiers

| Fichier | Ce qu'il fait |
|---|---|
| `seuils.mjs` | **Les seuils qui décident du vert, de l'ambre et du rouge.** Le fichier le plus important du projet. |
| `spots.json` | Le registre des lieux. Ajouter un spot = ajouter une entrée ici, rien d'autre à toucher. |
| `build.mjs` | Le script qui interroge l'API et fabrique les paquets. |
| `.github/workflows/matai.yml` | La programmation automatique deux fois par jour. |

---

## Pourquoi `seuils.mjs` est le fichier le plus important

Il contient la seule chose qui distingue Mata'i d'un affichage de chiffres :
**la décision**. Trois jeux de seuils, parce qu'une même houle ne veut pas
dire la même chose selon ce qu'on va faire :

- **lagon** — le récif absorbe la houle du large, seul le vent compte
- **passe** — la houle longue déferle sur le seuil, la période pèse autant
  que la hauteur
- **large** — ni abri ni seuil, hauteur et vent bruts

Il y a aussi une **hystérésis** : une heure ne repasse au vert que si elle
est franchement sous le seuil. Sans ça, quand le vent oscille autour de 20
nœuds, les barres horaires clignotent vert-ambre-vert-ambre et l'app a
l'air de ne pas savoir ce qu'elle raconte.

**Les valeurs actuelles sont provisoires.** Elles sortent d'une estimation,
pas de l'expérience de quelqu'un qui sort en mer. C'est exactement ce que
les entretiens avec les pêcheurs et les prestataires doivent corriger.
Quand tu changes ces nombres, tu changes tout le produit — l'application et
le backend lisent le même fichier, il n'y a pas deux vérités possibles.

---

## Le mettre en route pour de vrai

1. **Crée un dépôt GitHub** (privé, c'est très bien) et pousse ce dossier
   dedans.
2. Dans l'onglet **Actions**, active les workflows.
3. Clique sur « Prévisions Mata'i » puis « Run workflow » pour lancer une
   première fois à la main et vérifier que ça passe.
4. Ensuite, ça tourne tout seul à 06h00 et 18h00, heure de Tahiti.

Coût : **zéro**. GitHub Actions est gratuit pour un dépôt privé jusqu'à
2 000 minutes par mois, et ce script en consomme moins d'une par exécution.
Pas de serveur à louer, pas de machine à surveiller.

Pour que l'application lise les paquets, deux options : rendre le dépôt
public et servir les fichiers par GitHub Pages, ou les recopier vers un
hébergement à toi. On verra ça au moment de brancher l'app.

---

## Avant le lancement : l'abonnement Open-Meteo

L'offre gratuite d'Open-Meteo **interdit l'usage commercial** — défini comme
toute application qui a des abonnements ou affiche de la publicité. Tant que
tu développes, tu es dans les clous. Le jour où tu publies, il faut prendre
l'offre Standard, **29 $ par mois**, un million d'appels.

Le script est déjà prêt : pose ta clé dans une variable d'environnement
appelée `OPEN_METEO_CLE` et il bascule tout seul sur l'endpoint client. Sur
GitHub, ça se met dans *Settings → Secrets and variables → Actions*.

Mention obligatoire à faire figurer dans l'app, licence CC-BY :
**« Données météo : Open-Meteo.com »**, avec un lien vers la licence.

---

## Taille des paquets

Mesurée sur les neuf îles :

- une île : **24 Ko brut, 1 Ko compressé**
- les neuf îles ensemble : **130 Ko brut, 4 Ko compressé**

Autrement dit, un pêcheur des Tuamotu peut télécharger **toute la Polynésie
pour 4 Ko**, soit moins qu'une photo de mauvaise qualité. La contrainte de
connectivité qui inquiétait au départ n'en est pas une.

Il faut simplement que ton hébergement serve les fichiers en gzip — GitHub
Pages le fait par défaut.

---

## Et AROME dans tout ça ?

L'étude de faisabilité recommandait AROME Outre-mer à 2,5 km comme
différenciateur principal, et ça reste vrai. Mais AROME arrive en GRIB2 : il
faut le télécharger, le décoder, extraire un point d'une grille. C'est
plusieurs semaines de travail avant d'avoir le premier écran.

Ce backend part donc d'Open-Meteo, dont on a vérifié qu'il fonctionne sur la
Polynésie. **AROME viendra en couche supplémentaire** : le jour où il est
prêt, seule la fonction qui remplit `heures` change. Le reste — les seuils,
les paquets, l'app, la programmation — ne bouge pas d'une ligne.

C'est fait pour.
