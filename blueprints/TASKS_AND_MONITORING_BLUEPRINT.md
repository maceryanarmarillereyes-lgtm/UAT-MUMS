# Tasks and Monitoring Blueprint

## Scope
- `public/js/pages/my_task.js`
- `public/js/pages/distribution_monitoring.js`
- `public/js/pages/team_config.js`
- Backend routes: `api/tasks/*`, `api/team_config`, distribution export APIs

## Feature inventory
1. **My Task**
   - Assigned/distribution tabs, status updates, problem modal.
   - Task creation form + upload parsing + auto-assignment modal.
2. **Distribution Monitoring**
   - Team-lead/admin command-center monitoring and workload completion signals.
3. **Team Config**
   - Team schedule/task templates and assignment configuration.

## Data flow map
- `my_task` consumes distributions/items/members endpoints.
- `distribution_monitoring` aggregates live task metrics, role/team filtered.
- `team_config` writes baseline scheduling/task structures consumed by task orchestration.

## Do-not-break contracts
- Keep role/team isolation for monitoring views.
- Keep task status transition logic and modal side effects.
- Keep schema contracts used by task routes and exports.

## Change checklist
- [ ] Task item status transitions still valid.
- [ ] Team config save/load remains deterministic.
- [ ] Monitoring board does not expose unauthorized team data.

## Change log
- **2026-04-20** — Initial tasks/monitoring blueprint created.
