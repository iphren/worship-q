# Lyrics subtitles and scene control for OBS

Worship Q puts the lyrics on your live stream as well as on the projector, and controls OBS
for you, from any computer of the church or from a phone.

## A subtitle overlay for the stream

The **subtitle overlay** shows the lyrics on a transparent background, for an OBS Browser
Source over your camera. It follows the projector slide by slide, and its lines are never
wrapped.

- On the computer running Worship Q, add `http://127.0.0.1:47310/overlay/subtitle` as a
  Browser Source. It needs no internet. The full slideshow is at
  `http://127.0.0.1:47310/slideshow`.
- On a streaming computer without Worship Q, a link made in **Settings → Browser outputs**
  shows the overlay or the slideshow through your church's server.

Bible passages and web pages are not shown on the subtitle overlay: switch to a scene with
the slideshow for those.

## OBS controls in Worship Q

Turn on OBS's WebSocket server once, then **Control OBS on this computer** in Worship Q's
settings. On the Present page you then have:

- a small picture of what is on the stream
- a **switch** button between two scenes you choose, for example lyrics and camera
- every scene, and **Stream**, **Record** and **Camera** (OBS's virtual camera) on and off

Every approved phone gets the same controls, through the free Worship Q public server or
your church's own; with a church server, so does every computer of the workspace. Stopping the stream or a recording asks first.

[Setting up OBS, in the volunteer guide](/guide/#obs)
