# HackAuth0Backend

Backend for the HackAuth0 demo project. This service exposes a small API that hooks into Auth0 for authentication, integrates with GitHub to inspect PRs, and uses GROQ's LLM to generate PR reviews. It also can send notification emails via Resend.

Deployed: https://hackauth0backend.onrender.com

## Key features

- Generate automated PR reviews using a GROQ LLM model.
- Post review comments back to GitHub PRs.
- Create GitHub issues on behalf of an authenticated user.
- Small agent endpoints for credential management (via Auth0 token vault).

## Tech

- Node.js (CommonJS)
- Express
- Auth0 (JWT verification)
- GitHub API (via axios)
- GROQ SDK (LLM)
- Resend (email)

## Quickstart (local)

Prerequisites: Node.js (16+), npm.

1. Clone the repo

2. Install dependencies

```
npm install
```

3. Create a `.env` file in the project root with the environment variables listed below.

4. Run in development mode

```
npm run dev
```

Or run the production start:

```
npm start
```

The server listens on the port defined by `PORT` (default 6000). Health check: GET `/`

Deployed URL: https://hackauth0backend.onrender.com

## Environment variables

The project reads these variables (see `config/env.js`):

- `PORT` - optional, defaults to 6000
- `AUTH0_DOMAIN` - your Auth0 domain (used to verify JWTs)
- `AUTH0_CLIENT_ID` - Auth0 client id (used by some admin flows)
- `AUTH0_CLIENT_SECRET` - Auth0 client secret
- `GROQ_API_KEY` - API key for GROQ (used by `services/ai.service.js`)
- `RESEND_API_KEY` - API key for Resend email service
- `NOTIFY_EMAIL` - optional email address used for notifications (fallback present in code)

You may also need other provider tokens stored or provisioned via Auth0 (the app retrieves GitHub tokens from the user's identity vault via `services/auth.service.js`).

## NPM scripts

- `npm run dev` — start with `nodemon` (`src/server.js`)
- `npm start` — start production server

## Important API endpoints

All endpoints that modify or read user data require a valid Auth0-issued JWT in the `Authorization: Bearer <token>` header. The middleware that enforces this is `middleware/auth.middleware.js`.

- GET `/` — health check (public)

- POST `/agent/review` — run the automated PR agent (requires auth)
	- body: { "repo": "owner/repo" }
	- flow: lists PRs, grabs files, generates review using the GROQ LLM, posts comment, sends an email notification.

- GET `/agent/credentials` — list linked credentials for the authenticated user (requires auth)

- DELETE `/agent/credentials/:provider/:providerId` — unlink a provider credential for the authenticated user (requires auth)

- POST `/github/issue` — create an issue (requires auth)
	- body: { "repo": "owner/repo", "title": "Issue title", "body": "Issue body" }

- POST `/github/review` — generate a review for a specific PR (requires auth)
	- body: { "repo": "owner/repo", "prNumber": 123 }
	- Response includes the AI-generated review and metadata (truncated or not).

## AI behavior

The AI review is generated in `services/ai.service.js` using the GROQ chat completion API and a Llama model. The service passes a strict system prompt and returns the assistant response. Note the code truncation to ~8000 characters — large PRs are truncated before sending to the LLM.

## Email notifications

Emails are sent via Resend (`services/email.service.js`). Set `RESEND_API_KEY` to enable sending. `NOTIFY_EMAIL` can be used to force a delivery target for notifications in some flows.

## Notes

- Auth: this repo expects an Auth0 setup. JWT verification uses the Auth0 JWKS endpoint built from `AUTH0_DOMAIN`.
- GitHub tokens are expected to be retrieved via `services/auth.service.js` (the app looks up per-user GitHub tokens saved in Auth0 identity vault).
- The deployed instance is available at: https://hackauth0backend.onrender.com

## License

This project includes an existing `LICENSE` file — consult it for license details.

## Contact

For questions about the deployed demo or environment variables, check the `config/` folder and the controllers/services — they contain most of the integration details.
