# Toonflow Back Agent Notes

## Repositories

- Frontend repository: `https://github.com/clown466/toonflowweb`
- Backend repository: `https://github.com/clown466/toonflowback`
- Keep frontend and backend commits separate.

## Commit Habit

After a backend change is implemented and verified successfully, create a focused local git commit for that successful change.

- Run the relevant verification first, usually `git diff --check` and `yarn lint` for backend changes.
- Commit only files that belong to the completed change.
- Do not include unrelated user edits or unfinished work in the commit.
- Use a concise commit message describing the result.
- Do not push to GitHub unless the user explicitly asks to upload/push.

## Development Modes

- Existing preview service runs on port `10588`.
- Backend hot development can run through `docker-compose.dev.yml` on port `10589`.
- Frontend hot development can proxy to the development backend through `npm run dev:hot:backend` in the frontend repository.
