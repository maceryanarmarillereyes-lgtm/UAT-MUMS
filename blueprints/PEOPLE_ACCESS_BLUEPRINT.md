# People and Access Blueprint

## Scope
- `public/js/pages/users.js`
- `public/js/pages/members.js`
- `public/js/pages/privileges.js`
- `public/js/pages/commands.js`
- Backend routes: `api/users/*`, role/permission related settings docs

## Feature inventory
1. **Users Management**
   - User create/update/delete flows with role restrictions.
   - Edit/schedule rights determined by actor role + team boundaries.
2. **Members View**
   - Team/member roster rendering, profile and workload perspectives.
3. **Privileges**
   - Super-admin role feature toggles and delegated permission matrix.
4. **Commands**
   - Runtime surfacing of delegated permissions into command tiles.

## Authorization contracts
- Super-admin full control.
- Team-lead restricted to own-team member operations.
- Members limited self-service only.
- Delegated commands must map to existing permission keys.

## Do-not-break contracts
- Never loosen role boundaries without explicit policy change.
- Keep delegated permission keys backward compatible.
- Preserve busy/cooldown behavior in user save flows.

## Change checklist
- [ ] Role boundary checks validated.
- [ ] Privilege toggles still reflected in Commands page.
- [ ] User edit API payload unchanged or migrated safely.

## Change log
- **2026-04-20** — Initial people/access blueprint created.
