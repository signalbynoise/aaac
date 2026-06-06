# Run checkpoints — per Run, per phase

Checkpoints live under each Run:

```text
state/runs/{run_id}/
  run.json
  checkpoints/{phase}.json
  artifacts/
```

Gitignored except this README. Enables resume after gate block or crash.

Each checkpoint records:
- run_id, command, phase, timestamp
- outputs required by contracts/skills for that phase
- confidence, gate results when applicable
- next pending phase

Do not commit active runs to git.
