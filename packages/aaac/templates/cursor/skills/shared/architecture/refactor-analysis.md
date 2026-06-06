---
name: refactor
description: Analyze code for SOLID violations, code smells, and master-rules compliance; suggest targeted, low-risk refactorings. Use when the user asks to refactor, review architecture, reduce complexity, extract modules, or runs /refactor on a file, directory, or module.
argument-hint: "<file_or_module> [--focus srp|ocp|lsp|isp|dip] [--threshold low|medium|high]"
effort: medium
disable-model-invocation: true
---

# SOLID Refactoring Assistant

Analyze code for SOLID violations and suggest targeted improvements.

**Mandatory:** Read [docs/master_rules.md](../../docs/master_rules.md) (especially §19 Module Size Budgets) before analysis. Master rules are non-negotiable — if a SOLID suggestion conflicts with them, the master rules win.

## Purpose

Identify refactoring opportunities based on:
- SOLID principle violations
- Code smells and anti-patterns
- Complexity metrics
- Duplication detection
- Master rules compliance (SSOT, layer separation, no inline components/styles, explicit state machines, validation at boundaries)

## Parse Arguments

From `$ARGUMENTS` (or the user's message), resolve:

| Input | Scope |
|-------|-------|
| Single file path | Deep file analysis |
| Directory path | Cross-file pattern detection |
| `--focus=<principle>` | Filter findings to one SOLID letter |
| `--threshold=high` | Only report high-impact issues (large files, mixed layers, critical smells) |

Default target: path the user named, or the file/module under discussion.

## Instructions

### Step 1: Scope Analysis

Determine the refactoring scope from user input:
- Single file: Deep analysis
- Directory: Pattern detection across files
- Function/class: Focused extraction suggestions

```bash
TARGET="${1:-.}"
if [ -f "$TARGET" ]; then
  wc -l "$TARGET"
  echo "Single file analysis"
elif [ -d "$TARGET" ]; then
  find "$TARGET" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" \) | wc -l
  echo "Directory analysis"
fi
```

Also read the target with codebase tools (Grep, Read) — do not rely on shell alone.

### Step 2: SOLID Violations Detection

#### S - Single Responsibility

Look for:
- Files over budget (see Master Rules §19: routes 200, components 250, lib 300, openrouter 350)
- Functions over 80 lines (or nested callbacks over 40)
- Classes with > 10 methods
- Mixed concerns (data + UI + business logic)

**Master rules overlay:**
- UI doing fetch, business logic, or state orchestration (Rule 2)
- Domain logic in components or route handlers
- Duplicated state (local + store, multiple stores) (Rule 1)
- Side effects during render (Rules 8, 14)
- Files that violate "one truth" by mirroring server data

```bash
find "$TARGET" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) -exec wc -l {} + 2>/dev/null | sort -rn | head -10
```

#### O - Open/Closed Principle

Look for:
- Switch/case statements on types
- Repeated if/else type checking
- Direct modifications vs extensions

**Master rules overlay:**
- Feature behavior extended by editing core modules instead of adding strategy/handler modules (Rule 3)
- Hardcoded branching that should live in schemas or configuration (Rule 4)

#### L - Liskov Substitution

Look for:
- Overridden methods that throw "not implemented"
- Type checks before method calls
- Empty method overrides

#### I - Interface Segregation

Look for:
- Large interfaces (> 10 methods)
- Classes implementing unused interface methods
- Fat service classes

**Master rules overlay:**
- Props/interfaces forcing consumers to depend on unused fields
- "God" context or store slices consumed wholesale

#### D - Dependency Inversion

Look for:
- Direct instantiation of dependencies (`new Service()`)
- Hardcoded class references
- Missing dependency injection

**Master rules overlay:**
- Infrastructure (API, DB) imported directly into UI
- Utilities with hidden side effects (Rule 14)
- Missing validation at boundaries — trust of raw input/API data (Rule 13)

### Step 3: Master Rules Smell Pass

After SOLID, scan for these project-specific violations:

| Rule | Smell | Where to look |
|------|-------|---------------|
| 1 SSOT | Duplicated constants, mirrored state | `src/app/store/`, component local state |
| 2 Layers | Business logic in `src/app/components/` | Components with fetch, transforms, rules |
| 4 No hardcoding | Magic strings/numbers/IDs | Inline literals, layout numbers |
| 5–6 UI | Inline `style={}`, nested component defs | `src/app/components/` |
| 8 Flow | Circular imports, UI-triggered indirect mutations | Import graph, event handlers |
| 9 State machines | Ad-hoc boolean flags for complex flows | `useState` clusters, string unions without machine |
| 10 Async | Non-cancellable effects, overlapping requests | `useEffect`, route handlers |
| 13 Boundaries | Missing Zod/schema parse on API I/O | `server/routes/`, `src/app/api.ts` |
| 16 Errors | Swallowed errors, silent fallbacks | empty `catch`, `?.` chains without logging |
| 19 Logging | Bare `console.log`, missing structured logs | `server/`, async paths |
| 20 Testing | Changed behavior without tests | Colocated `*.test.ts` |

Map each finding to the rule number in output.

### Step 4: Code Smells

Use Grep/Read (preferred) or:

```bash
# Long parameter lists (5+ comma-separated params — heuristic)
rg -n "function [^(]+\([^)]*,[^)]*,[^)]*,[^)]*," "$TARGET" 2>/dev/null | head -10

# Deep nesting (8+ spaces / 2+ tab levels — heuristic)
rg -n "^\s{16,}\S" "$TARGET" 2>/dev/null | head -10
```

Also check:
- Duplicate logic blocks (similar functions, copy-pasted handlers)
- Long methods and deep nesting
- Magic numbers/strings (Rule 4)
- Missing early returns

For duplication at repo scale, optionally suggest running the `fallow` skill if the user wants static analysis.

### Step 5: Complexity Assessment

For each issue found, assess:
- **Impact**: How much code is affected?
- **Risk**: What could break?
- **Effort**: Lines to change, tests needed?
- **Master rule**: Which rule(s) does fixing this satisfy?

Prioritize: clarity and predictability over clever abstractions (Rule 22).

## Output Format

Use this template exactly:

---

### 🔧 Refactoring Analysis

**Target**: [file/directory]
**Lines Analyzed**: [count]
**Focus**: [all | srp | ocp | lsp | isp | dip]
**Threshold**: [low | medium | high]

### 📊 SOLID Scorecard

| Principle | Status | Issues Found |
|-----------|--------|--------------|
| Single Responsibility | 🟡/🟢/🔴 | [summary] |
| Open/Closed | 🟡/🟢/🔴 | [summary] |
| Liskov Substitution | 🟡/🟢/🔴 | [summary] |
| Interface Segregation | 🟡/🟢/🔴 | [summary] |
| Dependency Inversion | 🟡/🟢/🔴 | [summary] |

### 📐 Master Rules Scorecard

| Area | Status | Top violations |
|------|--------|----------------|
| SSOT & layers | 🟡/🟢/🔴 | [e.g. UI fetching in component] |
| UI discipline | 🟡/🟢/🔴 | [e.g. inline components] |
| Boundaries & errors | 🟡/🟢/🔴 | [e.g. unvalidated API body] |
| Async & state | 🟡/🟢/🔴 | [e.g. ad-hoc flags vs state machine] |
| Testing & logging | 🟡/🟢/🔴 | [e.g. no tests for changed module] |

### 🎯 Priority Refactorings

#### 1. [Highest Impact] - [Short title]

**Violation**: [SOLID principle + Rule #]
**Current**: [what the code does today, with path:line]
**Suggested**:
```
[Before structure]
    ↓ [Extract | Move | Replace pattern]
[After structure]
```
**Risk**: [Low | Medium | High] — [why]
**Tests Needed**: [what to add/update]

#### 2. [Second Priority] - [Short title]

**Location**: `path/file.ts:line`
**Current**:
```typescript
// minimal illustrative snippet
```
**Suggested**: [concrete pattern — strategy, extract module, move to domain, etc.]
**Risk**: [Low | Medium | High]

(Include 3–5 items max unless `--threshold=low`.)

### 📝 Code Smells

| Smell | Location | Rule/SOLID | Severity |
|-------|----------|------------|----------|
| Long Method | `api.ts:calculateTotal` (120 lines) | SRP | 🟠 High |
| Duplicate Code | `utils/*.ts` | SSOT (Rule 1) | 🟡 Medium |
| Deep Nesting | `parser.ts:parse` | — | 🟡 Medium |

### 🚀 Quick Wins (Low Risk, High Value)

1. [Concrete, scoped action]
2. [Concrete, scoped action]
3. [Concrete, scoped action]

### ⚠️ Technical Debt Notes

- [Items to defer — document why per Rule 21 if suggesting exceptions]

---

## Refactoring Safety Checklist

Before applying suggestions:

- [ ] Tests exist for affected code (Rule 20)
- [ ] Create feature branch
- [ ] Commit current state (only when user asks)
- [ ] Apply **one** refactoring at a time
- [ ] Run tests after each change
- [ ] Review diff before committing
- [ ] No scope creep — minimal diff (user preference)
- [ ] Document any intentional rule exception (Rule 21)

## Applying Refactorings

When the user asks to implement (not just analyze):

1. Read surrounding code; match existing conventions
2. Preserve layer boundaries: UI → state → domain → infrastructure
3. Centralize schemas and validation at boundaries
4. Extract to new files (no inline components)
5. Add/update behavioral tests, not implementation-detail tests
6. Use structured logging on new async paths (Rule 19)

## Usage

**Analyze specific file:**
```
/refactor src/services/user.ts
```

**Analyze directory:**
```
/refactor src/api/
```

**Focus on specific principle:**
```
/refactor --focus=srp src/services/
```

**With complexity threshold:**
```
/refactor --threshold=high
```

## References

- [docs/master_rules.md](../../docs/master_rules.md) — project non-negotiables
- Martin Fowler's Refactoring Catalog
- Clean Code by Robert C. Martin
- SOLID principles by Robert C. Martin
