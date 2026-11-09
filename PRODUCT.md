# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing static HTML/CSS/JavaScript frontend with a Node.js contact backend; preserve this stack.

## Users

Prospective students and their families, current students and parents, teachers, alumni, and other visitors looking for information about the Collège Privé de l'Ouest (CPO).

## Product Purpose

The CPO website presents the collège, its educational approach, admissions, family contact, and public school information. Success means visitors can quickly understand the school and find the right next step, especially contacting the school or asking about admissions.

## Positioning

CPO is a general and technical secondary-education collège in Bafoussam, Cameroon. The site is intended to provide useful information to its school community and prospective families, including on mobile devices and slower connections.

## Operating Context

The public website is French-first and includes an English version. The current frontend is static HTML, CSS, and JavaScript; a Node.js backend handles contact submissions. The existing routes include the home page, school information, admissions, and contact.

## Capabilities and Constraints

- Visitors can browse public information without an account.
- The current contact form submits to the backend API and requires server-side SMTP environment configuration.
- The staff portal includes administrator/teacher sign-in, publications, attachment management, teacher accounts, and private result entry. These workflows require the configured Supabase project and authorized accounts.
- The homepage may present school news, announcements, admissions information, family links, and a school gallery when verified CPO content and assets are supplied.
- Do not invent current announcements, examination results, contact details, school claims, or student imagery. Missing factual content must remain an explicit placeholder until supplied by the user.
- Reuse the CPO name, existing favicon, existing page content, and working contact behavior. The Collège Jean Tabi website is a structural reference only; its text, images, branding, and distinctive page design are not to be copied.

## Brand Commitments

Keep the CPO / Collège Privé de l'Ouest identity and its French-first, bilingual French/English communication. The user confirmed that the project should retain CPO branding while using the reference site only as inspiration for information organization.

## Evidence on Hand

- Existing page content: `cpo_frontend/index.html`, `about.html`, `admissions.html`, and `contact.html`.
- Existing visual assets: `cpo_frontend/favicon.svg`.
- No school photography, verified news feed, or gallery assets were present in the inspected frontend when this record was written. The user said they will provide content files.

## Product Principles

- Make essential school information easy to find for families and students.
- Keep public pages lightweight and usable on mobile networks.
- Distinguish verified school information from placeholders.
- Preserve the existing working admissions/contact path.
- Keep the founder portrait and school gallery as clearly labeled placeholders until the CPO supplies approved photos.
