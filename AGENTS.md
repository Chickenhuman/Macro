# Repository Workflow

This repository expects implementation work to follow the rules below unless the user explicitly asks otherwise.

## 1. Plan First When Requested
- If the user asks for a plan first, provide the plan before editing code.
- After the plan is shared, continue through implementation without stopping at partial progress unless blocked.

## 2. Test After Every Patch
- After any code or behavior change, run thorough verification before closing the task.
- Default verification target is `npm test`.
- If `npm test` cannot run, run the broadest available subset such as `npm run test:unit` and explain the gap in the final response.
- Do not skip testing just because the change looks small if runtime behavior could be affected.

## 3. Commit And Push By Default
- After implementation and verification complete, create a git commit and push to `origin/main`.
- Only skip commit/push if the user explicitly says not to, asks to review first, or wants local-only work.
- If commit/push ordering races, verify branch status and rerun `git push origin main` until local and remote match.

## 4. Keep Docs Current
- If behavior, UI, workflow, setup, test flow, or developer expectations change, update `README.md`.
- If session-level operating rules change, keep this `AGENTS.md` in sync.
- Do not leave new features undocumented when they are user-facing or change development workflow.

## 5. Final Closeout
- Final responses should include:
  - what changed
  - what was verified
  - whether commit/push completed, including the latest commit hash if available
