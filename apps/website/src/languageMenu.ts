// Closes the header's language menu (layout.ts) on Esc or a click or tap outside it. The menu
// is a `<details>`, so it opens and closes on its button without this.

const menu = document.querySelector<HTMLDetailsElement>('.language-menu');

if (menu) {
  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.open) return;
    menu.open = false;
    menu.querySelector('summary')?.focus();
  });
}
