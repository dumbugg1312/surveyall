# media/

Video and image files served as static assets (Cloudflare Workers serves
everything in this repo that `.assetsignore` doesn't exclude).

The home page's background loop lives here:

    media/home-loop.mp4     1280x720, H.264, no audio track, web-optimized
    media/home-loop.jpg     poster frame — shown while the video loads,
                            and instead of it for anyone with reduced
                            motion turned on

Keep any single file under 25 MiB: that is Cloudflare's hard cap on one
static asset, and a deploy fails rather than warns when a file exceeds it.
