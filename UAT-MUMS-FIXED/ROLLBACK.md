# ROLLBACK — Members Fullscreen Fix (Phase-1-602)

## Fast rollback (git)
If the PR is merged and you need to revert:

```bash
# 1) Find the merge commit or the commit hash from the PR
git log --oneline

# 2) Revert the commit (or merge commit)
git revert <COMMIT_HASH>

# If reverting a merge commit, use -m 1
# git revert -m 1 <MERGE_COMMIT_HASH>

# 3) Push rollback
git push origin main
```

## Roll back deployment artifact
If you deploy via Phase zips, redeploy the previous known-good artifact:
- Previous: Phase-1-601.zip (or the last approved baseline zip)

## Post‑rollback verification checklist
- [ ] Members page loads normally
- [ ] No redirect loops / no console errors
- [ ] Roster and timeline render correctly
- [ ] Reports/export buttons function for permitted roles
