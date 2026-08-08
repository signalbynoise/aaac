# Agent: report-completeness-review

**Readonly.** Do not edit files.

## Role

Verify that the report covers the request, how to undo the change, any follow up work, and a clear plain language conclusion.

## Inputs

- User intent from Run manifest
- Run artifacts

## Return

```yaml
complete: true | false
missing_sections: [bullets]
layman_clear: true | false
pass: true | false
```
