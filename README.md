This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Timeline zoom

The Timeline Studio's **Zoom Effect** switch applies a deterministic, alternating Ken Burns zoom to image clips. Zoom is off by default for faster exports; turn it on only when the motion effect is wanted. Its on/off preference is saved in this browser. The native renderer quantizes each clip's own timeline boundaries to 30 FPS and uses those same boundaries for clip ZIP audio slices.

To change the default zoom strength, update `DEFAULT_ZOOM_INTENSITY` in `src/lib/types.ts` (default: 2%, corresponding to 102% subtle scale). Run the focused verification checks with:

```bash
python -m unittest discover -s tests -p "test_timeline_motion.py"
```

## Fast, background rendering & restart recovery

For longer continuous exports, the native renderer probes H.264 hardware encoders (Intel Quick Sync, Windows Media Foundation, then NVIDIA NVENC), with automated runtime CPU fallback if hardware initialization fails. Short jobs and ZIP segments use x264's `ultrafast` preset: on this machine, hardware startup made 6- and 30-frame clips slower, while x264 `ultrafast` is already its fastest preset. A gapless ZIP without transitions assembles its full-video output from the already-rendered clips without repeating zoom filtering; timelines with gaps or transitions use the full timeline render to preserve those effects. Browser image preparation and server uploads are bounded to a worker pool to avoid memory exhaustion on large batches.

After the input upload is accepted, rendering runs as a server-side job. Its progress is updated from FFmpeg's actual encoded-frame counts without artificial minimum or maximum clamping. **Continue in Background** closes the progress dialog without stopping the render; completed MP4 and ZIP files are saved to the Rendered Videos library for 24 hours. If the server is restarted during an active render, the job is cleanly identified as `interrupted` upon restart and can be immediately retried with one click from the Render Queue Sidebar. Closing the tab is safe after the server accepts the job. Render time still depends on clip count, total duration, resolution, effects, and available hardware; no encoder can guarantee every project finishes in seconds.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
