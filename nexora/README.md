# NEXORA 2D Online World

Separate application package; existing Chert AI source files are preserved.

## Required environment
- DATABASE_URL: internal connection string of the existing Render PostgreSQL database.
- SESSION_SECRET: random secret, minimum 32 characters.
- NODE_ENV=production.

The migration creates only new tables prefixed nexora_ and nexora_sessions. It does not drop, truncate, or alter existing tables.

## Run
cd nexora && npm install && npm start

## Implemented foundation
- Email/username registration and login with server-side PostgreSQL sessions.
- Password hashing with Node.js scrypt.
- Character persistence.
- Eight seeded public rooms.
- 2D canvas city scenes and touch movement controls.
- WebSocket presence and position synchronization.
- Persistent room chat.
- Server-side role check for admin overview.

Not implemented yet: password recovery email delivery, direct messages, friend requests and moderation UI, inventory/shop, private rooms, full avatar sprite sheets and end-to-end browser tests. These must not be described as complete until implemented and verified.
