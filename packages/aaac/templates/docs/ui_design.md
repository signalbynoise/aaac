# UI design and CSS — {{PROJECT_NAME}}

Generic best practices for styling user interfaces. **Applies to all UI work** — read before writing or refactoring CSS.

Canonical rules summary: Master Rules §5 (no inline styling) and §41 (CSS discipline).  
Project-specific tokens and component paths: [project_context.md](./project_context.md).

---

## The problem

Agents often treat CSS like backend architecture. They add abstractions too early: token systems, deep nesting, utility generators, theme layers, variants, wrappers, unnecessary JS, and defensive overrides.

Senior frontend CSS is usually the opposite:

1. Use normal CSS first.
2. Keep selectors shallow.
3. Avoid specificity fights.
4. Make the component own only its own styling.
5. Use modern CSS only when it removes code.

Modern CSS should **simplify**, not add ceremony:

- [Cascade layers](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/Cascade_layers) — control priority without specificity wars
- [Custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties) — repeated values, not a parallel design system
- [Container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries) — components adapt to parent size, not only viewport breakpoints
- [`:where()`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:where) — zero specificity; easier overrides when needed

---

## Bad agent CSS

```css
.card-wrapper .card-container .card[data-variant="primary"] .card-content > div:first-child h3.title {
  color: var(--semantic-color-heading-primary-default);
  margin-bottom: var(--spacing-scale-component-card-title-bottom-md);
}

.card-container.theme-light.layout-grid.size-medium.state-default {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
}
```

**Problems:** too many layers, too much naming, too much specificity, unclear ownership.

---

## Better senior CSS

```css
@layer base, components;

@layer base {
  :root {
    --space: 1rem;
    --radius: 0.75rem;
    --border: #ddd;
    --text: #1f1f1f;
    --muted: #666;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: system-ui, sans-serif;
    color: var(--text);
  }
}

@layer components {
  .card {
    container-type: inline-size;
    padding: var(--space);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .card h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }

  .card p {
    margin: 0;
    color: var(--muted);
  }

  @container (min-width: 32rem) {
    .card {
      display: grid;
      grid-template-columns: 12rem 1fr;
      gap: var(--space);
      align-items: start;
    }
  }
}
```

```html
<article class="card">
  <img src="/image.jpg" alt="">
  <div>
    <h2>Simple card</h2>
    <p>Responsive because of its container, not the whole viewport.</p>
  </div>
</article>
```

---

## Agent checklist (before writing CSS)

Ask internally:

1. **Can this be solved with one class?**
2. **Can layout be handled by flex, grid, or container queries?**
3. **Can I avoid IDs, deep selectors, `!important`, and JS for styling?**
4. **Are these tokens actually reused, or am I inventing architecture?**
5. **Does this component own only its own styles?**

> The best CSS implementation is often boring, local, shallow, and easy to delete.

---

## Rules

### Selectors and specificity

- Prefer single class on the component root; style descendants sparingly and shallowly
- No chains longer than **two** levels unless documented
- Avoid `!important` — fix layer order or structure instead
- Use `:where()` for resets and shared bases that should not win specificity wars

### Layers and ownership

- Use `@layer` to separate base, components, and utilities
- One CSS file (or clearly scoped block) per component when the project uses component CSS
- Do not style another component's internals from a parent — use composition or props

### Tokens and variables

- Custom properties for values that **repeat** in the same file or theme
- Do not build a semantic token tree (`--semantic-color-heading-primary-default`) until plain variables prove insufficient
- Project-wide token files live in one place — see [project_context.md](./project_context.md)

### Layout

- Flexbox and grid before custom positioning
- Container queries for component-level responsiveness; media queries for page-level breakpoints
- Avoid fixed heights unless the design requires them

### JavaScript and styling

- Do not use JS to set layout or colors that CSS can handle
- Class toggles for state are fine; inline `style` objects are not (Master Rules §5)

### Framework notes

- CSS Modules, scoped Vue/Svelte styles, and colocated `.css` files are all valid — same discipline applies
- Utility-first frameworks: use utilities at the markup layer; do not generate bespoke utility systems inside agent-written CSS unless the project already uses one

---

## Accessibility (see also Master Rules §37)

- Semantic HTML first (`button`, `nav`, `main`, `article`, headings in order)
- Visible focus styles — do not remove outlines without a replacement
- Color is not the only indicator of state
- Respect `prefers-reduced-motion`

---

## When to escalate complexity

Add a design system layer (shared tokens, variants, themes) only when:

- The same values appear in **many** components and drift is causing bugs
- Multiple products share one UI package
- The team has documented ownership of that package in project context

Until then, prefer the senior CSS approach above.

---

## Anti-patterns

| Anti-pattern | Why it fails |
|--------------|----------------|
| Wrapper divs only for styling hooks | DOM noise, unclear ownership |
| `data-variant` + five modifier classes on one node | State explosion |
| Global overrides with high specificity | Breaks other components silently |
| CSS-in-JS theme objects for static layout | Harder to delete, couples render to style |
| Inventing tokens before second use | YAGNI — violates minimal complexity |

---

## References

- [Cascade layers — MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/Cascade_layers)
- [Using CSS custom properties — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties)
- [CSS container queries — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)
- [`:where()` — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:where)
