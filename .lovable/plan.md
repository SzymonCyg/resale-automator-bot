
# Vinted Manager — panel + wtyczka Chrome

## Architektura

```
┌────────────────────┐        ┌──────────────────────┐        ┌──────────────┐
│  Wtyczka Chrome    │───────▶│  Panel webowy        │───────▶│ Lovable      │
│  (MV3)             │  HTTPS │  (TanStack Start)    │  RLS   │ Cloud (DB)   │
│  działa na         │        │  UI, eksport, regu-  │        │ konta, regu- │
│  vinted.pl/fr/...  │◀───────│  ły, harmonogram     │◀───────│ ły, logi     │
└────────────────────┘        └──────────────────────┘        └──────────────┘
       ▲                                                              ▲
       │ używa cookies                                                │
       │ zalogowanego                                                 │
       │ użytkownika                                                  │
       ▼                                                              │
   vinted.pl API ──────────────── pobiera dane / wykonuje akcje ──────┘
```

Wtyczka jest "rękami" — działa w przeglądarce użytkownika, ma sesję Vinted. Panel jest "mózgiem" — przechowuje konta, reguły, szablony, harmonogramy i logi.

## Co powstanie

### 1. Panel webowy (ta aplikacja)

**Strony:**
- `/auth` — logowanie / rejestracja (email + Google)
- `/` (po zalogowaniu) — dashboard: lista podłączonych kont Vinted, status wtyczki, ostatnie akcje
- `/accounts/:id/items` — lista przedmiotów konta, filtry, eksport Excel/CSV
- `/accounts/:id/auto-bump` — wybór przedmiotów + harmonogram (co ile godzin)
- `/accounts/:id/auto-reply` — edytor reguł: słowo kluczowe → odpowiedź, fallback, włącz/wyłącz
- `/accounts/:id/logs` — historia akcji (bump, odpowiedzi, błędy)
- `/download-extension` — instrukcja instalacji wtyczki + przycisk pobierania ZIP

**Design:** ciemny, kompaktowy, "operatorski" — inspirowany Linear/Raycast. Akcent zielono-mietowy (kolor Vinted ma teal). Bez generycznego SaaS.

### 2. Wtyczka Chrome (Manifest V3)

Plik ZIP w `public/vinted-helper.zip`, do pobrania z panelu.

**Komponenty:**
- `content script` na `*://*.vinted.*/*` → ma dostęp do sesji, CSRF token, robi fetche do Vinted API
- `background service worker` → `chrome.alarms` co N minut: bump zaplanowanych przedmiotów, polling wiadomości
- `popup` → status połączenia z panelem, kod parowania, on/off
- komunikacja z panelem przez `externally_connectable` (origin panelu) + REST do API panelu z tokenem konta

**Parowanie wtyczka ↔ konto panelu:**
1. Panel generuje kod parowania (UUID, 10 min TTL)
2. Użytkownik wkleja kod do popupu wtyczki
3. Wtyczka wymienia kod na długoterminowy `device_token` (zapisany w `chrome.storage`)
4. Wtyczka identyfikuje się tokenem w nagłówku przy każdym requeście do `/api/public/extension/*`

### 3. Backend (server functions + public API routes)

**Server functions** (panel ↔ DB, z auth użytkownika):
- CRUD kont, reguł, szablonów, harmonogramów
- generowanie kodu parowania
- pobranie listy przedmiotów / logów do UI

**Public API routes** (`/api/public/extension/*`, autoryzacja przez `device_token`):
- `POST /pair` — wymiana kodu na token
- `POST /sync/items` — wtyczka wysyła zsynchronizowane przedmioty
- `GET /tasks` — wtyczka pyta o zlecone zadania (bump X, odpowiedz na wiadomość Y szablonem Z)
- `POST /tasks/:id/result` — wynik zadania (sukces/błąd)
- `POST /messages` — nowe wiadomości z Vinted do analizy regułami
- `GET /reply-suggestions/:messageId` — odpowiedź wg reguł

## Model danych (Lovable Cloud)

- `profiles` (id → auth.users, display_name)
- `vinted_accounts` (id, user_id, label, vinted_user_id, country, created_at, last_sync_at, status)
- `vinted_items` (id, account_id, vinted_item_id, title, price, currency, status, url, photo_url, created_at_vinted, last_bumped_at, raw jsonb)
- `auto_bump_settings` (account_id, enabled, interval_hours, item_ids text[], next_run_at)
- `reply_rules` (id, account_id, priority, match_type [contains/regex/exact], pattern, response_template, enabled)
- `reply_fallback` (account_id, template, enabled)
- `action_logs` (id, account_id, type [bump/reply/sync/error], item_id, message, payload jsonb, created_at)
- `extension_devices` (id, user_id, device_token_hash, label, last_seen_at)
- `pairing_codes` (code, user_id, expires_at, used_at)
- `tasks` (id, account_id, type [bump/reply], payload jsonb, status [pending/running/done/error], result jsonb, created_at, completed_at)

Wszystkie tabele z RLS po `user_id`. `user_roles` + `has_role()` jak w wytycznych. Public API routes używają `device_token_hash` do mapowania na `user_id` przed zapisami.

## Plan wdrożenia

**Krok 1 — fundament**
- Włącz Lovable Cloud
- Auth (email + Google), strona `/auth`, layout `_authenticated`
- Migracja: wszystkie tabele wyżej + RLS + grants

**Krok 2 — panel UI (dane mockowane lokalnie)**
- Design system (ciemny, mietowy akcent, font Inter + Space Grotesk)
- Dashboard, lista kont, lista przedmiotów, eksport Excel/CSV
- Edytor reguł odpowiedzi, ustawienia auto-bump
- Strona pobierania wtyczki

**Krok 3 — public API dla wtyczki**
- `/api/public/extension/*` z weryfikacją `device_token`
- Generator kodu parowania w panelu
- Endpointy sync/tasks/messages

**Krok 4 — wtyczka Chrome**
- Manifest V3, content script, background worker, popup
- Parowanie z panelem, wysyłanie listy przedmiotów
- Pętla zadań: pobierz `tasks` → wykonaj na Vinted → zwróć wynik
- Polling skrzynki → wyślij wiadomości do panelu → zastosuj reguły
- Spakowanie do `public/vinted-helper.zip`

**Krok 5 — pętla auto-bump i auto-reply**
- Scheduler po stronie panelu (przeliczanie `next_run_at`, tworzenie `tasks`)
- Wtyczka wykonuje, panel loguje, dashboard pokazuje wyniki

## Co dostaniesz w tym pierwszym etapie (ten request)

Skupiam się na **Kroku 1 + 2 + szkielecie 3**, żeby panel był w pełni używalny i ładny, a integracja z wtyczką miała gotowe API. Wtyczka i pełna pętla zadań to kolejny krok — powiem wprost kiedy skończę MVP panelu, żebyś mógł zdecydować czy idziemy dalej w tym samym podejściu.

## Ostrzeżenia

- Vinted nie ma oficjalnego API. Automatyzacja przez wtyczkę jest zgodna z tym, co robi przeglądarka użytkownika, ale **może naruszać ToS Vinted** i w skrajnych przypadkach prowadzić do ograniczeń konta. Używasz na własną odpowiedzialność.
- Agresywne bumpowanie (co kilka minut) zwiększa ryzyko. Domyślny minimalny interwał: 3h.
- Auto-odpowiedzi powinny mieć opcję "tylko sugeruj, nie wysyłaj automatycznie" na start — dodam taki tryb.
