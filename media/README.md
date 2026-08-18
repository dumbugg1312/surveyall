# media/

Video and image files served as static assets (Cloudflare Workers serves
everything in this repo that `.assetsignore` doesn't exclude).

The home page's background loop lives here:

    media/home-loop.mp4     1280x720, H.264 at 1600 kbps, no audio track,
                            web-optimized (moov atom first)
    media/home-loop.jpg     poster frame — shown while the video loads,
                            and instead of it for anyone with reduced
                            motion turned on

Keep any single file under 25 MiB: that is Cloudflare's hard cap on one
static asset, and a deploy fails rather than warns when a file exceeds it.

## On sharpness

The master is 1280x720, so the page caps the video at 900 CSS px
(`.showcase` in styles/home.css). Beyond that a 2x display is upscaling —
at the full 1088px column it invents 2176 pixels from 1280 and the UI
text in the loop goes soft, which reads as a cheap video rather than as a
bitrate setting.

Re-master at 1920x1080 and the cap can go back up to the full column
width. Bitrate to use then: ~2000 kbps, which lands around 15 MB for a
61-second loop.
