# CPO — Collège Privé de l'Ouest

Site institutionnel du Collège Privé de l'Ouest, collège d'enseignement général et technique. Le projet comprend une interface responsive, un formulaire de contact réel et une base de contenu prête pour un lancement professionnel.

## Ce qui est couvert

- Présenter le collège, son approche pédagogique et ses valeurs de manière claire et institutionnelle.
- Mettre en avant le positionnement général et technique du CPO.
- Proposer une navigation simple vers les sections collège, parcours, admissions et contact.
- Valoriser l'espace familles et les parcours d'accompagnement.
- Présenter un parcours d'admission en plusieurs étapes.
- Ajouter automatiquement l'objet adéquat pour les demandes d'admission ou le suivi d'un dossier.
- Afficher le français par défaut et permettre la version anglaise.
- Gérer le thème clair/sombre avec mémorisation dans le navigateur.
- Maintenir une palette institutionnelle basée sur le bleu, le bleu marine et l'ivoire.
- Adapter le site aux écrans mobiles et aux préférences de réduction des animations.
- Envoyer les messages via une API backend sécurisée et des variables d'environnement.
- Préparer un cadre pour un déploiement léger sur un hébergeur Node.js standard.

## Structure

```text
cpo_frontend/
  index.html         # page d'accueil principale
  about.html         # page présentation du collège
  admissions.html    # page admissions
  contact.html       # page contact dédiée
  styles.css         # design, thème clair/sombre et responsive
  script.js          # traductions, thème, navigation et formulaire
cpo_backend/
  server.js          # API contact + serveur statique
  package.json       # dépendances Node.js
  .env.example       # variables d'environnement SMTP
  .env               # configuration locale (non versionnée)
```

## Démarrage local

```powershell
npm install --prefix cpo_backend
Copy-Item cpo_backend/.env.example cpo_backend/.env
```

Complétez ensuite les variables `SMTP_USER` et `SMTP_PASSWORD` dans `cpo_backend/.env`. Pour Gmail, utilisez un mot de passe d'application et non votre mot de passe principal.

Lancer le site :

```powershell
npm start --prefix cpo_backend
```

Puis ouvrir :

```text
http://localhost:8000
```

Sans configuration SMTP, le site retourne un message explicite au lieu d'échouer silencieusement.

## Déploiement

### Option simple : Render

1. Créer un service Web Node.js sur Render.
2. Connecter le dépôt GitHub du projet.
3. Définir le dossier racine du service sur le dépôt principal.
4. Configurer les variables d'environnement :
   - `PORT=8000`
   - `CONTACT_RECIPIENT=nnoguem@gmail.com`
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=465`
   - `SMTP_SECURE=true`
   - `SMTP_TLS_REJECT_UNAUTHORIZED=true`
   - `SMTP_USER=...`
   - `SMTP_PASSWORD=...`
5. Définir la commande de démarrage :

```bash
cd cpo_backend && npm install && npm start
```

### Option plus robuste : conteneur Docker

Un `Dockerfile` peut être ajouté pour un déploiement dans un environnement plus standardisé. Le serveur actuel est déjà prêt pour un hébergement Node classique car il sert les fichiers statiques et expose l’API de contact.

## Bonnes pratiques de production

- Ne pas versionner les identifiants SMTP réels.
- Utiliser des variables d’environnement sur l’hébergeur.
- Vérifier la délivrabilité du compte mail utilisé.
- Tester le formulaire après publication sur la vraie URL de production.
