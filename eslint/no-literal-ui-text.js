/**
 * Refuses interface text written into components (translation plan, phase 1): JSX text with
 * letters in it, and plain strings in the attributes people read or hear. Words come from the
 * catalogue in packages/i18n through `t()` instead.
 */
const ATTRIBUTES = new Set([
  'title',
  'aria-label',
  'aria-valuetext',
  'aria-description',
  'placeholder',
  'alt',
  'label',
  'hint',
  'confirmLabel',
  'submitLabel',
]);

/** Text that is the same in every language: names and symbols. */
const ALLOWED = [
  /^Worship Q$/,
  /^OBS$/,
  /^CCLI$/,
  /^PDF$/,
  /^YouVersion$/,
  /^API\.Bible$/,
  /^ESV$/,
  // Environment variables, addresses and the start of one.
  /^[A-Z][A-Z0-9_]+$/,
  /^[a-z0-9-]+\.[a-z]{2,}$/,
  /^https?:\/\/$/,
];

const hasLetters = (text) => /\p{L}/u.test(text);
const allowed = (text) => ALLOWED.some((pattern) => pattern.test(text.trim()));

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Interface text comes from the translation catalogue.' },
    messages: {
      text: 'Interface text “{{text}}” belongs in packages/i18n; use t().',
    },
    schema: [],
  },
  create(context) {
    const report = (node, text) =>
      context.report({ node, messageId: 'text', data: { text: text.trim().slice(0, 40) } });
    return {
      JSXText(node) {
        if (hasLetters(node.value) && !allowed(node.value)) report(node, node.value);
      },
      JSXAttribute(node) {
        const name = typeof node.name.name === 'string' ? node.name.name : null;
        if (!name || !ATTRIBUTES.has(name) || !node.value) return;
        const value =
          node.value.type === 'Literal'
            ? node.value.value
            : node.value.type === 'JSXExpressionContainer' &&
                node.value.expression.type === 'Literal'
              ? node.value.expression.value
              : null;
        if (typeof value === 'string' && hasLetters(value) && !allowed(value)) report(node, value);
      },
    };
  },
};
