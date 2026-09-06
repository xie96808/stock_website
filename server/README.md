# Stage 2 API server

1. In `server/`: install dependencies, then run migrate, then start.
2. App: http://127.0.0.1:8787 (serves static site + `/api/v1` auth).
3. Avatars: `/images/avatars/01.svg` … `12.svg` (zodiac placeholders).

Routes: register, login, logout, GET/PATCH /me, password change, recovery reset/recover, DELETE /me.
