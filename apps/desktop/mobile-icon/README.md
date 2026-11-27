# The phone and tablet app's icon

This is the desktop icon (`../app-icon.svg`), redrawn for phones and tablets. iOS and Android
round the corners themselves, so the yellow fills the square edge to edge. Android's adaptive
icon gets the star and the yellow as separate layers.

To make the icons again after changing these files, from `apps/desktop`:

```sh
pnpm tauri icon mobile-icon/manifest.json -o <scratch folder>
```

Then copy `<scratch folder>/ios/*.png` into
`src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/`, flattened, because the App Store
rejects an icon with an alpha channel. A round trip through JPEG with `sips` does it. Copy
`<scratch folder>/android/` over `src-tauri/gen/android/app/src/main/res/`. Leave the rest
alone: the desktop icons in `src-tauri/icons` come from `../app-icon.svg`.
