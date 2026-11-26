// The invitation page at app.worship-q.com/j, shown only when the Worship Q app is not
// installed (native apps plan, "The link router"). The invitation stays in the fragment, which
// the browser never sends; the page reads it here and loads nothing. It never forwards on its
// own: the visitor sees which church the invitation is for and chooses to continue.

import { routerView } from '@worship-q/protocol/invitation';
import { languageOf, STORES, WORDS } from './words';

const words = WORDS[languageOf(navigator.languages ?? [navigator.language])];
document.documentElement.lang = words.lang;

const view = routerView(location.hash);
const message = document.getElementById('message')!;
const button = document.getElementById('continue') as HTMLAnchorElement;
const getApp = document.getElementById('get-app')!;
const stores = document.getElementById('stores')!;

/** Puts the server's name in bold inside a sentence, without reading it as markup. */
function withServer(sentence: string, server: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const [before, after] = sentence.split('{server}');
  const strong = document.createElement('strong');
  strong.textContent = server;
  out.append(before ?? '', strong, after ?? '');
  return out;
}

if (view.kind === 'continue') {
  message.append(withServer(words.invitationFor, view.server));
  button.href = view.href;
  button.textContent = words.continueTo.replace('{server}', view.server);
  button.hidden = false;
} else if (view.kind === 'app-only') {
  message.textContent = words.needsApp;
} else {
  message.textContent = words.invalid;
}

const links = STORES.filter((store) => store.url);
if (view.kind !== 'invalid' && links.length > 0) {
  if (view.kind === 'continue') {
    getApp.textContent = words.orGetApp;
    getApp.hidden = false;
  }
  for (const store of links) {
    const link = document.createElement('a');
    link.href = store.url;
    link.rel = 'noreferrer';
    link.textContent = words[store.label];
    stores.append(link);
  }
  stores.hidden = false;
} else if (view.kind === 'app-only') {
  getApp.textContent = words.notYetInStores;
  getApp.hidden = false;
}
