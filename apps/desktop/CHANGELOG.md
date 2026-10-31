# Changelog

## [0.5.1](https://github.com/iphren/worship-q/compare/v0.5.0...v0.5.1) (2026-10-31)


### Bug Fixes

* improve update process messaging and restart confirmation ([6e3c48e](https://github.com/iphren/worship-q/commit/6e3c48e65be9e0547d41e408668cbf0de3450d2a))

## [0.5.0](https://github.com/iphren/worship-q/compare/v0.4.0...v0.5.0) (2026-10-31)


### Features

* enhance Live component with live text display and update RemoteItemView structure ([9eaa82f](https://github.com/iphren/worship-q/commit/9eaa82ff1f8294a111d878b5e63ba56367adb73b))

## [0.4.0](https://github.com/iphren/worship-q/compare/v0.3.0...v0.4.0) (2026-10-29)


### Features

* **remote:** implement song search functionality and run-sheet editing from remote controllers ([80bdbd7](https://github.com/iphren/worship-q/commit/80bdbd7d72553e84cdbf93246e98c25368da37ce))
* update icon options and improve output panel button styles; remove end presentation references ([70fa4ad](https://github.com/iphren/worship-q/commit/70fa4ad73c72bdac0c9c4fbc0d3001148c688202))


### Bug Fixes

* update close action logic in OutputPanel to handle disabled state correctly ([ff67e56](https://github.com/iphren/worship-q/commit/ff67e56cd0499406674e35b4cc57dfcf377a319e))

## [0.3.0](https://github.com/iphren/worship-q/compare/v0.2.0...v0.3.0) (2026-10-27)


### Features

* add locate button and improve slide following functionality ([a899c23](https://github.com/iphren/worship-q/commit/a899c2386c61b0b825f404da9a95c4ff2604c84d))
* enhance window restoration logic and state management ([2f2477f](https://github.com/iphren/worship-q/commit/2f2477f3695ba0537b875dd87fbcbdb11df6261b))
* implement ping-pong mechanism for connection stability and timeout handling ([9b3e9f8](https://github.com/iphren/worship-q/commit/9b3e9f81983baea80ba13c8048f8abe51e126538))

## [0.2.0](https://github.com/iphren/worship-q/compare/v0.1.0...v0.2.0) (2026-10-25)


### Features

* add background selection functionality to SongForm and SettingsPage ([065c7c6](https://github.com/iphren/worship-q/commit/065c7c670f39d47508235dedc81a096cb074a1fc))
* add clear screen functionality and update related components ([f42d7f9](https://github.com/iphren/worship-q/commit/f42d7f9935daffc83fa72ac0631494c14d960e02))
* add confirmation dialog for removing songs from the run sheet ([e04c71f](https://github.com/iphren/worship-q/commit/e04c71f6bb31a47a101da6e6957d15b413ad37ae))
* add DeckBadge component to display imported slide deck status in song listings ([33d158f](https://github.com/iphren/worship-q/commit/33d158fab8dd3e2e12e98c63212e33488a9f1df7))
* add functionality to add songs to run sheet with visual feedback ([736fbef](https://github.com/iphren/worship-q/commit/736fbefdc782c3f75b8a7e958032735c5adc9521))
* add item selection and flash effect in RunSheetEditor and Live components ([35fc759](https://github.com/iphren/worship-q/commit/35fc759dcb1b79e4451731e836d0ba377c354a8e))
* add keyedItemId prop to RunSheetEditor for improved item handling ([a79c80f](https://github.com/iphren/worship-q/commit/a79c80f1c8251f191f773e2b828f54b50b204bd9))
* add local desktop app ([cf96164](https://github.com/iphren/worship-q/commit/cf961647c21a3e758afbb10b68740f43458e8e17))
* add option to hide mouse cursor during slideshow ([ab849a9](https://github.com/iphren/worship-q/commit/ab849a926f9b48401088bbf790c99b828c34620c))
* add plugin to reload on logic change for better development experience ([671509e](https://github.com/iphren/worship-q/commit/671509e46189d2f9df48e50ca74ca05c32847493))
* add slide deck import functionality with LibreOffice and Ghostscript ([a44dd5d](https://github.com/iphren/worship-q/commit/a44dd5de47d43e5365688a49db33b551304f120b))
* add SongBackgroundFields component and integrate it into SongForm and SettingsPage for improved background management ([7f17889](https://github.com/iphren/worship-q/commit/7f17889f7099819cbfebbfa7fa2be6567b5f7831))
* add SongPeek component for displaying song details on hover ([61b1ff5](https://github.com/iphren/worship-q/commit/61b1ff5e879aeb754b1ed3e22e3dad3755409387))
* add SVG icons and update HTML to include favicon and apple touch icon ([2c1a57d](https://github.com/iphren/worship-q/commit/2c1a57d1da9e8fb0d73c22a77637771f880d23b1))
* add tabbed interface for song editor and adjust sidebar width in SongsPage ([0c97dea](https://github.com/iphren/worship-q/commit/0c97dea2d948aab4cca92a57f40a1b1ce87cda17))
* add tauri-plugin-window-state for window management and enhance UI with drawer functionality ([22d5e0d](https://github.com/iphren/worship-q/commit/22d5e0d2b71ca8c7c7c28b0a39218ced8cd5e5f1))
* add thumbnail support for slide images and update related components ([f896168](https://github.com/iphren/worship-q/commit/f896168a347ba243b26bad617e6a558ec50758db))
* add transition effect for lyrics in Slide component ([2deed1c](https://github.com/iphren/worship-q/commit/2deed1c785238e83a42b4343e9b83772e2247458))
* add video playback on hover in BackgroundPicker component ([77413bb](https://github.com/iphren/worship-q/commit/77413bba431d6fe8f14a63603ab7ae04ebf20ebe))
* add website support to songs, enabling live web page display during presentations ([38d9d16](https://github.com/iphren/worship-q/commit/38d9d161c3a52cd77ab419b5c80eb3b711df5e6a))
* disable auto-correction and spell check for search inputs in RunSheetEditor and SongsPage ([c315a4f](https://github.com/iphren/worship-q/commit/c315a4fd05eb0bd2e4bf063047bec0fdeb3f9a3d))
* enhance background settings with workspace and song tab options ([857c29b](https://github.com/iphren/worship-q/commit/857c29b6caa8687ecf8dae30538542c9d1e00827))
* enhance date display and navigation in CalendarPage component ([1cd3922](https://github.com/iphren/worship-q/commit/1cd3922c476a6ae53b3d999b9f59fd8e22268ece))
* enhance monitor management and output selection for macOS ([0e0eaf4](https://github.com/iphren/worship-q/commit/0e0eaf471f560f385f921b7889e08271d8081b8e))
* enhance navigation by adding icons to pages and improving NavButton component ([df208b1](https://github.com/iphren/worship-q/commit/df208b139e83b79169461cf0a3f41e63af5afa07))
* enhance output window management and presentation controls ([0f2af8e](https://github.com/iphren/worship-q/commit/0f2af8e863dc451dd4220ea9c064bced61058bca))
* enhance scroll handling and cleanup in OutputApp component ([667ca3f](https://github.com/iphren/worship-q/commit/667ca3f7fea84e7d03799293c737cdbeb46a7c56))
* enhance search functionality with hints for songs, slides, and websites ([38670ef](https://github.com/iphren/worship-q/commit/38670efcc57991ac5525c3175dc7b31b9c0c7e0b))
* enhance shortcuts functionality and update volunteer guide for slide navigation ([c552bce](https://github.com/iphren/worship-q/commit/c552bce6d892e09ac047ef18945e08628da06dcf))
* enhance slide navigation and presentation controls with new shortcuts and functionality ([9c7f52b](https://github.com/iphren/worship-q/commit/9c7f52b157b7a9b47a09fa6be665a56ce99946ba))
* enhance slide navigation and scrolling behavior in Live component ([7e77898](https://github.com/iphren/worship-q/commit/7e77898258cf38460ae676fac6b2afcc462e3e93))
* enhance song background handling with new types and localization support ([cf4bdeb](https://github.com/iphren/worship-q/commit/cf4bdeb03d476efca5302a40934ef1ebe69a3c1b))
* enhance song management with additional fields and search capabilities ([c98bc4a](https://github.com/iphren/worship-q/commit/c98bc4a28e0344b2f77edbf0461e0f2dbe3dffc5))
* enhance workspace background directory management and streamline output monitor retrieval ([4a9d348](https://github.com/iphren/worship-q/commit/4a9d348e1ed03504584e674e83b0a08f010b0d74))
* enhance workspace title handling and localization support ([5e40b22](https://github.com/iphren/worship-q/commit/5e40b227c03a4ab066d740a2460401b4f27a4cf5))
* implement automatic update functionality with process management ([d4d7cc1](https://github.com/iphren/worship-q/commit/d4d7cc122b30f3b916371343ecd064f6cace7f13))
* implement Church Library management for workspaces ([592d96a](https://github.com/iphren/worship-q/commit/592d96ab883cd50c380c4e24c0a8b867ac442044))
* implement drag-and-drop functionality for reordering songs in the run sheet ([dc0104d](https://github.com/iphren/worship-q/commit/dc0104ddf9ea8fcc8b3f9e0dbfff0a3383a5b64a))
* implement icon component and update navigation to use icons ([030cb07](https://github.com/iphren/worship-q/commit/030cb07e3b35adc4eb2b4f554cdee30d4d59177e))
* implement scroll memory functionality across multiple components ([7d269d6](https://github.com/iphren/worship-q/commit/7d269d68c6173098e083d5da00db87539151d50a))
* implement synchronization logic for workspace content and state management ([47865d0](https://github.com/iphren/worship-q/commit/47865d0ffab9130a5a5cfac3336b630bf7e05e3f))
* implement unblankOrNext action and enhance session browsing functionality ([0814d5d](https://github.com/iphren/worship-q/commit/0814d5d06060e908b4f6503f2e90291a85c88ee8))
* implement wellFormed function to handle broken surrogate pairs and update related components ([57d975a](https://github.com/iphren/worship-q/commit/57d975a9ccf3e4d6a21a90ffbdbcf6f431b80969))
* implement window dragging for slideshow output and enhance close event handling ([8fa0fdb](https://github.com/iphren/worship-q/commit/8fa0fdb532d8e520c554cd20cb8ca87981ed8022))
* improve date display in MonthCalendar and CalendarPage components ([566631a](https://github.com/iphren/worship-q/commit/566631a3310f79128e4c7720c1b0dae277345074))
* refactor nextMeetingDate logic and update presentation end behavior ([b77edc8](https://github.com/iphren/worship-q/commit/b77edc8c4cac84e4e17f8b236f4d69fa6d480f73))
* simplify live date display in Sidebar component ([137785a](https://github.com/iphren/worship-q/commit/137785af134318e4b1d8429057933496c7ae91a3))
* simplify window title format in English localization ([aa95b43](https://github.com/iphren/worship-q/commit/aa95b439aadf36029b19860a3efbc47b84505f3d))
* single desktop version source and release-please setup ([43a03aa](https://github.com/iphren/worship-q/commit/43a03aa547373c03bb7deedd07e22f6ad655d220))
* update CI/CD workflows for release management and add release checks ([bc3fd02](https://github.com/iphren/worship-q/commit/bc3fd02a1f813eac03be15f5d569e9eeca1c8e83))
* update color scheme for editing indicators in MonthCalendar and CalendarPage components ([9328e1b](https://github.com/iphren/worship-q/commit/9328e1b9d0b0a796e2700d7c4b23207021ed41d4))
* update color scheme for live and editing indicators across components ([bf903f7](https://github.com/iphren/worship-q/commit/bf903f767620f95ffb5ede8977edade607c9cf9c))
* update icon definitions and refactor OutputPanel action handling for improved clarity ([03f9cc1](https://github.com/iphren/worship-q/commit/03f9cc12ef85e6d308f65dde7229c3ec14da1770))
* update live state behavior to start presenting immediately with next meeting date if nothing is live ([d1444c7](https://github.com/iphren/worship-q/commit/d1444c786754993fa62cfd48f388ae024ef90776))
* update navigation and search functionality for songs library ([9044004](https://github.com/iphren/worship-q/commit/9044004bcee1c3d11576ef5aeb593ea70a515201))
* update nextMeetingDateAfter function to handle presentations ending before their date ([4c780c6](https://github.com/iphren/worship-q/commit/4c780c6eedc2c73a6fc0b72b0d8f96acf5af5933))
* update run sheet localization for improved clarity and user guidance ([fbe23bb](https://github.com/iphren/worship-q/commit/fbe23bb2c90f0061276296d2408bf850bf128a59))
* update subtitle handling to clear when a slide follows a song ([fa6ce27](https://github.com/iphren/worship-q/commit/fa6ce271eab321c806b51e2c70f2771e9c77163a))


### Bug Fixes

* adjust tab class for workspace background to improve layout responsiveness ([37eca62](https://github.com/iphren/worship-q/commit/37eca624386a8698f423f8a8338b95ae66c5c352))
* improve clarity of previous content messages in English localization ([23e0b77](https://github.com/iphren/worship-q/commit/23e0b77291a66a95428ac3372ea1157defab9df0))
* improve code styling for URL display and button in SettingsPage ([d718622](https://github.com/iphren/worship-q/commit/d7186221569627f103285843c21fa66c699089c2))
* improve font missing message and optimize missing character handling in SettingsPage ([b96b590](https://github.com/iphren/worship-q/commit/b96b5902fdf2ff4fa73fed41153454730b2a814e))
* revert previous change ([58ab387](https://github.com/iphren/worship-q/commit/58ab38703b578d46f82c8fd7d3da138db453ee48))
* update action text for "kept too long" button to improve clarity ([a47eb82](https://github.com/iphren/worship-q/commit/a47eb822ad03b833865bd143afa2108520429299))
* update canOpen logic to ensure correct behavior when no live date is present ([ff7a8be](https://github.com/iphren/worship-q/commit/ff7a8be5ceaf7668c3c8f201e254f8c4bfa67501))
* update navigation button icons for better clarity ([07cdab3](https://github.com/iphren/worship-q/commit/07cdab3bc4d110d4556024330ec2d2b8af2cb4ed))
* update output_monitor to use get_window instead of get_webview_window ([f6299c1](https://github.com/iphren/worship-q/commit/f6299c1e14cc40280dce087342b5bfda34bc7d5a))
* update previous content message for clarity ([07d80c8](https://github.com/iphren/worship-q/commit/07d80c8628ccdd60ae1cafb24b2c065a61befa86))
* update run sheet edit button label and improve copy button visibility logic ([3deea15](https://github.com/iphren/worship-q/commit/3deea157d492d3cd14eb9a74bd6a5eadc690dd83))
