---
paths: "**/*.tsx,**/*.jsx,**/*.component.html,**/*.css,**/*.scss"
---
# UI — house facts, Angular and React alike

- Colors, spacing, type sizes and radii come from the design tokens (CSS variables, Tailwind
  theme, the Angular theme); no hex, `rgb()` or magic pixel value outside the token files.
- Every async view has three states besides the data: loading, empty, error (with a retry). A
  blank screen or a spinner that never ends is a defect.
- No layout shift: reserve space for images, skeletons and async content (width and height,
  `aspect-ratio`, a fixed-size placeholder); late data never pushes visible content.

Framework specifics: the `angular` and `react` rules.