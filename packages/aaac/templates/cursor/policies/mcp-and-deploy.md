# Policy: MCP and deploy

Optional project overlay. Add rule files under `.cursor/rules/` when you use MCP servers or a deploy platform.

| Concern | Where to configure |
|---------|-------------------|
| Database MCP | `.cursor/rules/<provider>-mcp.mdc` — migrations, project ref, RLS |
| Deploy / hosting | `.cursor/rules/deploy.mdc` — service name, blueprint, smoke URL |

**Migrations:** When you add SQL under your migrations folder, apply via your configured database MCP immediately after the change.

**Deploy checks:** Use the MCP server your team configures in Cursor settings. Put vendor project IDs and service names in `docs/project_context.md` or `.cursor/rules/` — not in shared generic skills.

Generic installs ship without provider-specific rule files. Add them when you connect Supabase, Render, or another provider.
