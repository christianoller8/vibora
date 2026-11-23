# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (Angular 22 + Angular Material 3, responsive; phone-first for players, desktop-first for admins)

## Users

- **Players** (members and guests of a padel club). They book on the go, often from a phone, between other things. Job: find a free court at a time that works, book it in a few taps, or join an open match that is missing players and pay only their share of the fee.
- **Club admins**. Work at a desk or at the front desk, during the day and on the evening peak. Job: keep the court agenda full and conflict-free, see revenue, occupancy and cancellations at a glance, review incident reports, issue and check invoices, and invite staff.
- **Staff** (reception, maintenance). Invited by an admin with a limited role. Job: see today's agenda, handle check-ins, and report or follow up incidents (broken light, wet court, damaged net).

## Product Purpose

Víbora is a padel club management app. Its mechanism is a booking engine that never double-books a court, plus **open matches**: a player publishes a booking, other players join the missing spots, and the court fee is split automatically (e.g. "Faltan 2 · 6,50 € por jugador"). Around that sit incident reports, invoices and an admin metrics panel.

Success: a player books in under a minute; a match with open spots fills before it starts; an admin never has to resolve a clash by phone.

All data is synthetic (`@vibora.test` accounts, simulated money). It is a portfolio project, so the product also has to read well in screenshots and a README.

## Positioning

Not a generic sports-booking marketplace: it is one club's tool where the open-match fee split and a conflict-free agenda are first-class. The landing page sells the sport and the club; the app is a calm, fast working tool.

## Brand and voice

- Name: Víbora. Original logo: two curved lime fangs forming a V around a small diamond scale. Wordmark "VÍBORA", Manrope 800, with a lime "Í".
- Tone: sporty, direct, confident, never childish. Short imperative copy ("Reserva. Juega. Repite."). Controls name their action; errors name the problem and the recovery.
- Language: the app UI is Spanish (Spain: euro, 24 h clock, dd/mm). Project documentation is English.

## Constraints

- Accessibility: WCAG 2.1 AA minimum (4.5:1 body text, 3:1 large text and UI components), visible keyboard focus, no information by colour alone, touch targets of at least 44 px on phones.
- Dark theme is the default; light theme is a first-class option. Both must ship every token.
- Angular Material 3 is the base UI library; other libraries (charts etc.) are fine when needed. Colours live only in the theme files, as tokens.
- Blue is not a UI colour. It only appears inside court photography.
- Images: no third-party reference images or visible third-party brand logos anywhere. Photos are the user's own or logo-free stock (Unsplash/Pexels). Until then, labelled placeholders.
- Slots are 90 minutes; money in euros with comma decimals.

## Open questions

- Avatar = user profile photo or brand mascot?
- Light-theme `primary` for Material: keep dark olive (text-safe) with lime as `primary-container`, or flip so filled buttons use lime in both themes? (DESIGN.md assumes the first.)
- Which real photographs for the landing (courts, rackets, players)? Needs the user's own or logo-free stock.
- Do guests (not logged in) see prices and availability on the landing, or only after sign-in?
- Is there a club name/location to show on the landing, or does the landing stay generic?
