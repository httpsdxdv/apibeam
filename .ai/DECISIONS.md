# ApiBeam Decisions

- Firefox is the primary browser target; Chrome remains secondary/build-tested.
- API relay runs in Docker bound to localhost only.
- Browser extension runs on the Windows host because it needs the authenticated ChatGPT session.
- Local development uses deterministic room ID `local-cline` to make Cline configuration stable and startup automatable.
- Browser requests are serialized and correlated with request IDs.
- `/models` is answered locally and must never generate a ChatGPT prompt.
- Development follows branch -> test -> PR -> CI -> merge.
- Heavy workspace/log/backup data should migrate to D:\AIWorkspace; legacy C:\Users\dex\apibeam must never be cleaned/reset.
