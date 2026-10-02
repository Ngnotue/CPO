# Déploiement CPO

## URL de production recommandée

Choisir un domaine professionnel, par exemple :

- https://www.cpo-ecole.com
- https://www.collegepriveouest.com

La valeur réelle devra être ajoutée dans la variable d'environnement `APP_URL` sur l'hébergeur.

## Variables d'environnement

Dans l’environnement de production, configurer :

```env
PORT=8000
APP_URL=https://www.cpo-ecole.com
CONTACT_RECIPIENT=nnoguem@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_TLS_REJECT_UNAUTHORIZED=true
SMTP_USER=your-sender@gmail.com
SMTP_PASSWORD=your-app-password
```

## Déploiement sur Render

1. Créer un service Web Node.js sur Render.
2. Connecter ce dépôt ou le fork du projet.
3. Définir le dossier racine du service.
4. Ajouter les variables d’environnement ci-dessus.
5. Utiliser la commande :

```bash
cd cpo_backend && npm install && npm start
```

## Vérification après mise en ligne

- Ouvrir `https://votre-domaine.com`
- Vérifier que la page d’accueil s’affiche correctement.
- Vérifier le formulaire de contact.
- Vérifier `/api/health` pour confirmer le service backend.

## Checklist client

- [ ] Domaine acheté et pointé vers l'hébergeur
- [ ] Variables SMTP configurées
- [ ] Adresse de contact réelle validée
- [ ] Formulaire de contact testé depuis la vraie URL
- [ ] Page d’accueil finalisée et validée par le client
