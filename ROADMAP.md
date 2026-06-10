# Roadmap

Captured 2026-06-09 (from issue #37). These are next-horizon product directions, not committed work. Each needs a product decision before it becomes a scoped issue; when a direction is chosen, split it into concrete issues and check it off here.

## Follow-up areas

- [ ] **Monetization plan** — decide the model (one-time purchase, freemium, subscription) and what stays free.
- [ ] **Pro subscription features** — candidate gates: cloud recording storage, multi-device sync, teacher mode, advanced stats/growth analytics.
- [ ] **Native app support** — evaluate PWA install + Capacitor/Tauri wrappers vs. true native. The offline-first work (#19) is the foundation either way.
- [ ] **Notifications** — practice reminders (streak preservation) and assignment due dates. Web push vs. native push depends on the native-app decision.
- [ ] **Teacher mode** — teachers assign pieces to students and track their progress: roles/accounts, shared repertoire assignments, read access to student history and stats. Implies a real backend schema beyond the current `user_data` KV table.

## Sequencing notes

- Teacher mode and notifications are natural pro-tier anchors; the monetization decision should precede their implementation.
- Cloud recording storage (#20) and offline-first sync (#19) shipped 2026-06; they are prerequisites for the multi-device pro story.
